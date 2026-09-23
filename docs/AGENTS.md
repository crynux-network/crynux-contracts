## Document Index

- `contract-roles-and-status.md`: active and legacy contract roles under the Relay architecture.
- `l2-node-contract-deployment.md`: L2 node contract relationships, deployment parameters, and governance handoff.
- `owner-controlled-parameters.md`: authoritative classification and modification rights for staking parameters, bindings, ownership, observers, and user state.
- `emission.md`: CNX emission topology and accounting.

## Doc Update Requirements

When updating documentation files:

1. Read the entire document first to understand its structure, sections, and flow
2. Find the most appropriate location to integrate new content based on:
   - Logical relationship with existing sections
   - Document flow and narrative
   - Where readers would naturally expect to find the information
3. Integrate new content naturally into existing sections when possible:
   - Add as a paragraph within a relevant section
   - Extend an existing list or table
   - Add as a subsection under an appropriate parent section
   - Distribute across multiple sections if a feature affects different parts of the document
4. Do NOT simply create a new top-level section and place all new content there
5. Only create a new section if the topic is truly distinct from all existing content

Use specification language only in documents that define project requirements or technical architecture.

Requirement and architecture documents MUST state clear, final, testable decisions. They MUST NOT include recommendations, alternatives, speculation, uncertainty, or future-facing placeholders. Use `MUST`, `MUST NOT`, `SHALL`, and `SHOULD` only when expressing an actual requirement, and use `SHOULD` only when that requirement level is intended.

Operational runbooks, deployment guides, and descriptive documents MUST describe current behavior and exact procedures in plain descriptive or imperative language. They MUST NOT use requirement keywords merely to describe an existing implementation, explain a command, or state a current configuration value.

## Chat Content Isolation

Documentation MUST be generated from task requirements and authoritative project sources only.
User chat instructions about removing content are editing actions, not document content.
The final document MUST NOT restate removal instructions.
If a content type is removed, it must be absent from the final document.

Example chat cycle:
- AI draft includes setup commands.
- User says remove setup commands and keep only flow.
- Wrong final doc line: This document does not include setup commands.
- Right final doc line: Run the flow in order: prepare environment, start services, execute deposit and withdraw, then verify results.
