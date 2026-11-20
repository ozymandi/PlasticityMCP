# Spec Delta

## ADDED Requirements

### Requirement: Pitfalls topic
`modelling_guide` SHALL offer a `pitfalls` topic with the field-tested traps of the server and of Plasticity (silent no-ops, batch failures, parameter names, id lists, rail sweeps, deep-pocket fillets, multi-edge loft ends), and the base guide text SHALL name the topic. It carries the same traps as the skill's "Pitfalls" section, without the skill-only placement rules, so models without the skill get them on demand.

#### Scenario: Topic served
- **WHEN** `modelling_guide` is called with `topic: "pitfalls"`
- **THEN** the answer is its own text, longer than 300 characters, and the base guide names `"pitfalls"`

#### Scenario: Only real tool names
- **WHEN** the catalog test reads the pitfalls text
- **THEN** every tool name it mentions is a tool of the server
