# Bounded payment policy circuit experiment

Run with Node.js 18+:

```sh
node experiments/tapeout-policy/poc.mjs
```

The experiment emits the NAND-only subset of the draft [TAP-02](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md) byte format. Inputs are unsigned integer price, daily spend and weekly spend, each width bits and little-endian in the packed input vector. Four trailing flags represent enabled, identity verified, endpoint allowed, and user confirmation. All caps are compile-time constants in the same units.

The predicate is: all four flags true, positive price, price <= per-call cap, daily spent + price <= daily cap, weekly spent + price <= weekly cap. Addition retains its carry bit; there is no wraparound bypass. The positive-price rule is an intentional restriction, not a claim of semantic equivalence to the existing PolicyKit evaluator.

## Observed local experiment

| Case | Count |
|---|---:|
| Exhaustive width-4 inputs for one cap configuration | 65,536 |
| Seeded 32-bit randomized cases | 10,000 |
| 32-bit boundary combinations | 1,728 |
| Decision mismatches | 0 |
| Out-of-range amount inputs rejected | 2 |
| Invalid opcode rejected | 1 |

The width-32 example emits 1,393 gates and 9,751 bytes of netlist. These measurements came from executing the same functions in a JavaScript isolate, not from running the entire repository test suite or a live chain.

## Trust boundary

This is a combinational predicate, not a payment authorization mechanism. A caller can forge the flags and spend values unless a separately authenticated controller computes them from authoritative state. The circuit does not authenticate identity, bind a signed transaction, reserve funds, serialize concurrent requests, enforce deadlines, or prove settlement. It does not sign or broadcast anything.

Before any deployment: verify the exact X Layer contract implementation and encoding against read-only calls; establish a fixed-point rounding and token-unit policy; bind the decision to the actual signed request and policy revision; atomically reserve and reconcile spend; check replays; benchmark gate count, gas and total deployment cost. Retain user approval for asset transfers. Do not claim the local test results are on-chain evidence.
