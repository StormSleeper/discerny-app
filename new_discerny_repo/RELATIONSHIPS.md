# Relationships
<!-- One line per Relationship, stored once (shown on both):
     `- A ~ B {kind: related}` (symmetric) or `- A -> B {kind: <kind>}` (involves, concerns, owns, uses).
     Validate: both IDs exist, no duplicates, nothing related to itself.
     `dependencies` on Items are separate. -->

- P-0001 -> SYS-0001 {kind: owns}
- PRJ-0001 -> SYS-0001 {kind: uses}
- T-0001 -> SYS-0001 {kind: concerns}
