# CLAUDE.md — Triad Control Tower

## What this repo is
A multi-depot logistics coordination platform for the PLG / Campeys / Wrings network, serving VPK Packaging. Covers:
- Data import pipeline: parsers for Desborough/VPK, Campeys/Selby, Banbury/Wellington
- Cross-depot load-sharing opportunity detection (full transfers, relay/part-load, light loads)
- Savings tracker logging confirmed transfers
- `job_transfers` cross-depot workflow (Propose / Accept / Decline / Complete)
- Planning tab: load consolidation, drag-and-drop, vehicle pairing, Excel export
- Transfers tab, Savings tab

## Backend
- Supabase project ID: `ahvyirnebbbfmktewdva`
- Netlify site: `triadcontroltower` (site ID `f7be2799-61b1-41f2-baf4-e8923240a239`)
- GitHub: `Macauleywc/Triad-Control-Tower`

### Key tables
`daily_plans`, `routes`, `job_transfers`, `transfers`, `customer_addresses` (2,035 postcode pairs for address auto-fill).

**Important:** Routes are stored relationally, not as JSONB. Select queries must use `routes(*)` syntax — do not assume a JSON blob structure.

## Standing rules — always follow these without being asked

1. **Cost-per-pallet logic differs by depot**: Selby bills per pallet; all other depots store total run cost. Don't apply a single flat formula across depots — check which model applies before calculating.
2. **CO2 factor: 0.85 kg/mile.**
3. **Transfer base cost: £444.77 + £0.50/mile round trip.**
4. **Light load threshold: 24 pallets.**
5. **Brand colours: Orange, Black, Grey — never blue**, consistent with all PLG-branded tools.

## Validation — required before any commit

Run `node --check <file>` on every changed file. Test parser changes against a sample of real data if available before pushing — a broken parser silently corrupts downstream Planning/Savings calculations.

## Deploy workflow

1. Edit directly in this cloned repo.
2. `node --check` on each changed file.
3. `git add`, commit with a clear message.
4. `git push origin main`.
5. Netlify auto-builds and publishes from the linked GitHub repo. Confirm at https://triadcontroltower.netlify.app; hard-refresh (Ctrl+Shift+R) if needed.

## Don't
- Don't assume `routes` is JSONB — it's relational.
- Don't apply Selby's per-pallet billing logic to other depots or vice versa.
- Don't skip `node --check`.
