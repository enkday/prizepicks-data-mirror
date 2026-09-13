# Acquisition integrity contract

The master `data/prizepicks.json` is the sole input to hierarchy generation.
Every derived observation retains its master hash, JSON pointer and observation
time. A hierarchy branch name or build timestamp does not certify freshness.

## Decimal lines (OpenAPI 1.2.0)

New master captures and hierarchy builds emit `line` as a decimal string.
The projection response is received as JSON text. Numeric `line_score` tokens
are converted to strings before JSON parsing; existing string values are kept.
For example, `229.500000000000001` remains `"229.500000000000001"` throughout
the master, hierarchy and small Action slices. Other numeric properties retain
their original JSON types.

Consumers must accept decimal strings and legacy JSON numbers and perform
comparisons with a decimal type. Do not coerce an exact line through a binary
float. This is a wire-type change for consumers that required numeric `line`;
update those clients before using a new capture. The OpenAPI schemas describe
both representations. Historical numeric captures cannot reconstruct precision
that was lost before this repair.

The hierarchy reads numeric JSON tokens with Python `Decimal`, preserves
decimal string spellings, and detects conflicts by decimal value. Equivalent
values such as `229.50` and `229.5` do not create a false conflict. Different
values at the same market remain separate observations with conflict flags.

## Per-league completeness

Each league is staged before any of its props enter the master. The configured
coverage is standard, active, single-stat projections; demon/goblin, inactive,
fantasy-score and combined-stat observations are explicit policy exclusions.

Each successfully decoded league reports:

- `sourceCount`: number of source projections.
- `acceptedCount`: eligible projections parsed successfully.
- `excludedCount`: projections excluded by the documented coverage policy.
- `rejectedCount`: projections that could not be safely interpreted.
- `publishedCount`: observations actually emitted in the master.

`sourceCount = acceptedCount + excludedCount + rejectedCount`. If any eligible
projection is malformed, the entire league is withheld: `ok` is false,
`publishedCount` and the legacy `count` are zero, and the error code is
`MALFORMED_PROJECTION`. Valid prefix rows from that league cannot leak into the
master. Other successful leagues can publish, with master completeness marked
`partial`. Transport or undecodable-payload failures have unknown `sourceCount`.
If no usable board is collected, the run fails without publishing a new capture.

The source payload is a curated board, not a claim to every PrizePicks product.
Source rows dropped by known scope rules are counted even in a successful run.
Final recommendations must independently verify coverage and freshness.
