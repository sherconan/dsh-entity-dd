# dsh-entity-dd · Cross-border counterparty due diligence

English | [中文](README.zh.md)

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It answers two questions about a foreign counterparty, in this order: **which legal person are you actually contracting with, and may this register record be relied on?**

Free official open data only. No API key, no stored credentials.

## Why not just another lookup tool

Wrapping a company register in a tool has been done. This plugin does the other half — the **judgement**.

One trading name routinely maps to several independent legal persons. Search "Contemporary Amperex Technology" and the register returns four:

```
Contemporary Amperex Technology AG                        Munich, DE
Contemporary Amperex Technology Thuringia SE              Arnstadt, DE
Contemporary Amperex Technology (Hong Kong) Limited       Hong Kong
Contemporary Amperex Technology Treasury Management (HK)  Hong Kong
```

These carry separate liability: **a contract with one cannot be enforced against another.** A plain lookup tool returns one record and moves on. This plugin puts the ambiguity in front of you and refuses to resolve it on your behalf.

The second question is whether the record is fit to rely on. Raw register output looks like this:

```
entityStatus: ACTIVE    registrationStatus: LAPSED
lastUpdateDate: 2023-08-31    nextRenewalDate: 2023-09-01
```

The plugin turns that into:

> The company itself is still trading, but its global entity registration has not been renewed since September 2023, and the record has gone unmaintained for three years.
> **Fit to rely on**: not on its own, for contracting purposes.
> **Next step**: obtain a commercial-register extract issued within the last 6 months and reconcile it field by field against the registration number on file.

## Install

```bash
dsh plugin --profile web add github:sherconan/dsh-entity-dd
```

Plain JavaScript, no build step. It activates on install: the package declares `dsh.bundle`, so `dsh plugin` appends it to the profile's layer stack automatically.

## Three tools

| Tool | Question it answers |
| --- | --- |
| `entity_search` | Which legal persons match this name, and which one do I mean? |
| `entity_dossier` | What is on file for this entity, and may I contract on it? |
| `entity_vat_check` | What if the counterparty has no LEI? (live EU VAT validation) |

The intended flow is `entity_search` → user confirms the entity → `entity_dossier`. Small and mid-sized businesses often hold no LEI but always hold a VAT number; that is what `entity_vat_check` is for.

## What the dossier contains

- **Verdict** — whether the record may be relied on, why, and what to request next
- **Particulars** — legal name, registered address, and the **national business-register number** plus its issuing authority, so you can go back to the local register yourself
- **Group structure** — direct parent, ultimate parent, direct subsidiary count
- **Risk findings** — which rules fired, each with its own advice
- **Data inspection table** — every field with its value, as-of date, source and confidence mark

The inspection table separates *data reliability* from *business risk*. An entity registered offshore whose record was updated two days ago has fresh data — being offshore is a business concern and must not contaminate the freshness judgement.

## The risk rules are yours to edit

Nine rules live in [`rules/risk-rules.json`](rules/risk-rules.json) as readable data, not code:

```json
{
  "id": "record-lapsed",
  "level": "amber",
  "dimension": "data",
  "when": { "field": "recordStatus", "op": "in", "value": ["LAPSED", "RETIRED"] },
  "label": "档案陈旧",
  "finding": "…",
  "advice": "…"
}
```

Thresholds and the offshore-jurisdiction list are judgement calls, not authoritative standards. Tune them to your own risk appetite.

## Data sources

| Source | Coverage | Cost |
| --- | --- | --- |
| GLEIF LEI register | Legal entities holding an LEI worldwide; daily golden copy | Free, no key |
| EU VIES | EU VAT numbers, answered live by each member state's tax administration | Free, no key |

## Coverage limits — read this first

**The LEI register only holds entities that obtained an LEI**, which skews heavily toward businesses active in financial markets. Measured registrations: Germany 254k, United States 358k, China 107k — **and Vietnam 368**.

In practice: **good for established mid-to-large businesses in Europe, North America, Japan and Korea; largely blind to small manufacturers in Southeast Asia.**

"Not found" is treated as a first-class result: the plugin states plainly that absence is not a risk signal and tells you what to do instead. EU small businesses are covered by the VAT fallback; non-EU small businesses currently are not.

Other known limits:

- A parent relationship is only recorded when the parent itself holds an LEI, so "not recorded" does not mean "no parent".
- Some member states (Germany among them) return VAT validity only and withhold the trader name. A withheld name is not a failed check.
- **No sanctions or export-control screening.** Restricted jurisdictions, dual-use goods and material credit exposure all require separate specialist screening.

## Disclaimer

This plugin performs register-record verification. Its output is intended to prompt human review and **does not constitute a compliance conclusion or legal advice**. The risk findings are heuristics and are no substitute for counsel, a compliance function, or a professional due-diligence provider.

## License

MIT
