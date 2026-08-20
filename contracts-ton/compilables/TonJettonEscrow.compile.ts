import { CompilerConfig } from "@ton/blueprint";

export const compile: CompilerConfig = {
  lang: "tolk",
  entrypoint: "contracts/TonJettonEscrow.tolk",
  withStackComments: true,
  withSrcLineComments: true,
  experimentalOptions: "",
};
