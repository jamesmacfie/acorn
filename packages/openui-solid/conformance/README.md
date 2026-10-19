# OpenUI conformance cases

`1.0/` is a copy of `spec/fixtures/1.0` from [thesysdev/openui](https://github.com/thesysdev/openui) at
commit `8d9c4c3`, under the MIT license in `LICENSE`. Don't edit the cases. To take a newer set, copy the
folder again and record the commit here.

The package's tests read them the way OpenUI's reference runners do: `src/conformance.test.ts` runs every
case's program check through lang-core, and `src/conformance.interactions.test.tsx` mounts the cases that
have `interactions.json` and replays them. The links inside `1.0/` point at OpenUI's spec, which isn't
copied.
