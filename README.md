# The picture that tastes of one ingredient

[![make.fun](https://make.fun/badge/the-picture-that-tastes-of-one-20261122-2047.svg)](https://make.fun/competitions/the-picture-that-tastes-of-one-20261122-2047)
[![rank](https://make.fun/badge/the-picture-that-tastes-of-one-20261122-2047/Kiowayyy2109/makefun-the-picture-that-tastes-of-one-20261122-2047/rank.svg)](https://make.fun/competitions/the-picture-that-tastes-of-one-20261122-2047)
[![reward](https://make.fun/badge/the-picture-that-tastes-of-one-20261122-2047/Kiowayyy2109/makefun-the-picture-that-tastes-of-one-20261122-2047/reward.svg)](https://make.fun/competitions/the-picture-that-tastes-of-one-20261122-2047)
Bounty: https://make.fun/bounty/the-picture-that-tastes-of-one-20261122-2047

`main.ts` is a dependency-free Node TypeScript program that procedurally draws one giant glossy strawberry — a single ingredient — with seeded pits, water droplets, a soft specular highlight, and a fresh green calyx against a warm dark vignette.
It renders at 1536×1536 with 2× supersampling, downsamples to 768×768, and writes `/output/entry.png` using its own PNG encoder built on `node:zlib`.
Run it with `node main.ts`; the output is fully deterministic (fixed-seed PRNG, no `Math.random`, no dates).
