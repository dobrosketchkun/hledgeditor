# Parser Test Journals

Use these files to validate parser behavior directly in the app.

- `01-valid-core.journal`  
  Valid examples; should produce no structural parser errors.

- `02-invalid-structure.journal`  
  Intentional malformed cases to verify error reporting precision.

- `03-multi-commodity.journal`  
  Confirms balancing is checked per commodity, not only by raw numeric sum.

- `04-includes-root.journal` + `04-includes-sub.journal`  
  Include parsing smoke test for root + included analysis flow.

Notes:
- Each file includes comments describing expected parser outcomes.
- If output differs from comments, that indicates a parser rule mismatch/regression.
