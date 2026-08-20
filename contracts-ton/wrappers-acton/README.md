# Generated Acton wrappers

The authoritative Linux CI creates `TonNativeEscrow.gen.tolk` here with:

```text
acton wrapper TonNativeEscrow -o wrappers-acton/TonNativeEscrow.gen.tolk
```

The generated Tolk wrapper is intentionally not committed. Acton-native tests
import it after the generation step, preventing a hand-written wrapper from
silently diverging from the contract ABI.
