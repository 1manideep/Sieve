# Invented names

Every organisation named in the Playground data is invented (20 section 19.6, 60 section 5.3). Before the dataset is final, search each name in the USPTO trademark search and a web search (20 section 21.18); if a real company in that sector uses it, rename it everywhere and record the new name here. `scripts/check-repo.mjs` checks that every sender domain in `emails.json` appears in this table, and warns while a check is still pending (`--strict` turns the warning into a failure).

| Name | Sector | Domains | Checked on | Result |
|---|---|---|---|---|
| Thistlewick Property Management | property management (landlord) | thistlewick-pm.example | pending | pending |
| Brimlow Power | electric utility | brimlowpower.example | pending | pending |
| Quorrel Labs | software company (Alex's employer) | quorrel-labs.example, code.quorrel-labs.example | pending | pending |
| Kestrelmoor Bank | bank | kestrelmoor.example | pending | pending |
| Pellwater Credit Union | credit union (auto loan) | pellwatercu.example | pending | pending |
| Swapfern | payment app | swapfern.example | pending | pending |
| Corvane Medical Group | medical clinic | corvanemedical.example | pending | pending |
| Fernquill Pharmacy | pharmacy | fernquill.example | pending | pending |
| Quellbrook Dental | dentist | quellbrookdental.example | pending | pending |
| Albatrine Air | airline | albatrine.example | pending | pending |
| Gullhaven Hotel | hotel | gullhaven.example | pending | pending |
| Crestmarrow Outfitters | outdoor clothing store | crestmarrow.example | pending | pending |
| Driftway Couriers | courier | (named in text only) | pending | pending |
| Voltwren Electronics | electronics store | voltwren.example | pending | pending |
| Tensorfield Digest | newsletter | tensorfield.example | pending | pending |
| Notewhistle | note-taking app | notewhistle.example, t.notewhistle.example | pending | pending |
| Tamsin Neighbors | neighborhood forum | tamsinneighbors.example | pending | pending |
| Parcelmoor Delivery | parcel delivery (the fake sender of the booby-trapped email) | parcelmoor-delivery.example, parcelmoor-redelivery.example, parcel-help.example | pending | pending |
| Hollowpine Mutual Insurance | renters insurance | (named in text only) | pending | pending |
| Quillbarrow Conservatory | wedding venue | (named in text only) | pending | pending |
| (people, no organisation) | friends and family | inbox.example, samandnoor.example | n/a | personal addresses; no organisation is named |

Real place names are limited to Chicago, Seattle and the airport codes ORD and SEA. No airline designator codes are used.
