# ACBLscore 8.33 pair movement reference data

The three small `.MOV` data files are extracted without executing the official
installer linked from https://www.acbl.org/getscore/:
https://cdn.acbl.org/ACBLSCORE/ACBL833W.exe

Installer SHA-256:
`36c67c5225b1d2ec8b601f29c23bc2e36ca97a039e9422ee064e8dfd9c0e44ab`

These fixtures exercise compact records, padded 25-round records, and a directional
Rover with unequal NS/EW group sizes. They contain mathematical pair/table/board
assignments and explanatory metadata, not executable software or player records.
Individual file hashes are pinned in `lib/acbl-movements.json`.

The full 75-entry catalog contains normalized numeric assignments, filenames and
hashes. Rebuild from an extracted official `Pair movements` directory with:

```
npx tsx scripts/import-acbl-catalog.ts "path/to/Pair movements"
```

This catalog covers the release's external pair files. It does not stand in for
verification of the separate internal HOWELL.LBR and ROVER.LBR generators.
