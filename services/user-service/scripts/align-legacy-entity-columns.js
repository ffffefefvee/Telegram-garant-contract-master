// One-time mechanical alignment of legacy entity decorators with migration columns.
// Dry-run by default; --write edits only source entity files where the exact
// snake_case column is proven to exist in the isolated local staging database.
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { Client } = require('pg');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const write = process.argv.includes('--write');
const supported = new Set(['Column', 'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn']);

function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? files(file) : entry.name.endsWith('.entity.ts') ? [file] : [];
  });
}

function decoratorCall(node, source, name) {
  return (ts.getDecorators(node) || [])
    .map((decorator) => decorator.expression)
    .find((expression) => ts.isCallExpression(expression) && expression.expression.getText(source) === name);
}

function tableName(node, source) {
  const call = decoratorCall(node, source, 'Entity');
  const arg = call?.arguments[0];
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

async function main() {
  const config = JSON.parse(readFileSync(join(root, '.local-e2e', 'staging-stack.json'), 'utf8'));
  const client = new Client({ host: '127.0.0.1', port: 55432, user: 'garant_user', password: config.pgPassword, database: 'garant_staging' });
  await client.connect();
  try {
    const columns = await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const actual = new Map();
    for (const row of columns.rows) {
      if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
      actual.get(row.table_name).add(row.column_name);
    }
    let changes = 0;
    for (const file of files(join(root, 'src', 'modules'))) {
      const content = readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      const edits = [];
      for (const statement of source.statements) {
        if (!ts.isClassDeclaration(statement)) continue;
        const table = tableName(statement, source);
        if (!table || !actual.has(table)) continue;
        const names = actual.get(table);
        for (const member of statement.members) {
          if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue;
          const property = member.name.text;
          if (names.has(property)) continue;
          const snake = property.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
          if (!names.has(snake)) continue;
          const decorator = [...supported].map((name) => decoratorCall(member, source, name)).find(Boolean);
          if (!decorator) continue;
          const argument = decorator.arguments[0];
          if (argument && !ts.isObjectLiteralExpression(argument)) continue;
          if (argument?.properties.some((part) => part.name?.getText(source) === 'name')) continue;
          if (argument) edits.push({ start: argument.getStart(source) + 1, end: argument.getStart(source) + 1, text: ` name: '${snake}',` });
          else edits.push({ start: decorator.getStart(source), end: decorator.end, text: `${decorator.expression.getText(source)}({ name: '${snake}' })` });
          console.log(`${table}.${property} -> ${snake}`);
          changes += 1;
        }
      }
      if (write && edits.length) {
        let updated = content;
        for (const edit of edits.sort((a, b) => b.start - a.start)) {
          updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
        }
        writeFileSync(file, updated, 'utf8');
      }
    }
    console.log(`${write ? 'Updated' : 'Would update'} ${changes} column decorators.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
