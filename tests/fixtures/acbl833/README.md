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

## Internal movement references

`lib/acbl-howell-records.json` and `lib/acbl-rover-records.json` contain only the
numerical route records from HOWELL.LBR and ROVER.LBR in the same pinned installer.
The decoder tests cover all 102 Howell records and all Rover records.

The eight `howell/*.MOV` and two `AM*.MOV` files are independent ACBLscore exports
published by MIT/Draper Lab Bridge Club, retrieved from:
https://web.mit.edu/mitdlbc/www/bridgemats/All-MOV.zip
Their roles are documented at:
https://web.mit.edu/mitdlbc/www/bridgemats/Wide/index.html
Hashes are pinned in reference-hashes.json.

Web arithmetic is independently checked against Tim Hill’s 18-table, 13-round
worked example: https://www.bridgewebs.com/baystate/Web%20movements.pdf
Large even Webs additionally match every cell of the official 28/30/32/34/36-table
MOV catalog. Other sizes have invariant tests, not independent official exports.
Rover direction variants have seat/board and mutation/CSV tests; the EW variants
have not yet been compared to independent ACBLscore exports.
