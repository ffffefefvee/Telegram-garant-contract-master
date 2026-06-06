param(
  [string]$BaseUrl = 'http://localhost:3001',
  [string]$Secret = $env:TELEGRAM_TEST_INJECT_SECRET
)

if (-not $Secret) {
  throw 'Set TELEGRAM_TEST_INJECT_SECRET or pass -Secret.'
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$headers = @{ 'X-Telegram-Test-Secret' = $Secret }

function Invoke-TelegramInject {
  param(
    [string]$Path,
    [hashtable]$Payload
  )

  return Invoke-RestMethod `
    -Method Post `
    -Uri "$BaseUrl/api/internal/telegram/test/$Path" `
    -Headers $headers `
    -Body ([System.Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Depth 8))) `
    -ContentType 'application/json; charset=utf-8'
}

function Write-Step {
  param(
    [string]$Label,
    [object]$Response
  )

  $text = ''
  if ($Response -and $Response.capture -and $null -ne $Response.capture.text) {
    $text = [string]$Response.capture.text
  }
  $text = $text -replace "`r?`n", ' | '
  Write-Host "STEP::$Label::$text"
}

$commandSteps = @(
  @{ label = 'start'; text = '/start' },
  @{ label = 'unknown-command'; text = '/zzzz' }
)

foreach ($step in $commandSteps) {
  $response = Invoke-TelegramInject -Path 'command' -Payload @{ text = $step.text }
  Write-Step -Label $step.label -Response $response
}

$callbackSteps = @(
  'settings_language',
  'lang_en',
  'menu_back',
  'lang_es',
  'menu_back',
  'deal_create',
  'deals_type_physical',
  'deals_list'
)

foreach ($callback in $callbackSteps) {
  $response = Invoke-TelegramInject -Path 'callback' -Payload @{ data = $callback }
  Write-Step -Label $callback -Response $response
}

$list = Invoke-TelegramInject -Path 'callback' -Payload @{ data = 'deals_list' }
$viewCallback = $list.capture.replyMarkup.inline_keyboard[0][0].callback_data
if ($viewCallback) {
  $view = Invoke-TelegramInject -Path 'callback' -Payload @{ data = $viewCallback }
  Write-Step -Label $viewCallback -Response $view

  $buttons = @()
  foreach ($row in $view.capture.replyMarkup.inline_keyboard) {
    foreach ($button in $row) {
      if ($button.callback_data) {
        $buttons += $button.callback_data
      }
    }
  }

  foreach ($button in $buttons) {
    $response = Invoke-TelegramInject -Path 'callback' -Payload @{ data = $button }
    Write-Step -Label $button -Response $response

    if ($button -like 'deal_invite_*') {
      $inviteText = ''
      if ($response -and $response.capture -and $null -ne $response.capture.text) {
        $inviteText = [string]$response.capture.text
      }
      $tokenMatch = [regex]::Match($inviteText, 'invite_([a-f0-9]+)')
      if ($tokenMatch.Success) {
        $startInvite = Invoke-TelegramInject -Path 'command' -Payload @{ text = "/start invite_$($tokenMatch.Groups[1].Value)" }
        Write-Step -Label 'start-invite' -Response $startInvite
      }
    }

    if ($button -like 'deal_wallet_*') {
      $wallet = Invoke-TelegramInject -Path 'command' -Payload @{ text = '0x1111111111111111111111111111111111111111' }
      Write-Step -Label 'wallet-address' -Response $wallet
    }
  }
}
