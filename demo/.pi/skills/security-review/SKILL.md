---
name: security-review
description: Review storefront input handling, secrets, payment boundaries, and abuse risks. Use for security-sensitive code or architecture decisions.
---
# Security review

Treat cart input as untrusted; enforce server-side limits. Do not store payment card data or commit tokens. Describe concrete risks and mitigations.
