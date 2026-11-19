# Spec Delta

## Purpose

Teach a model, through the skill and through `modelling_guide`, how to choose among all the tools and how to build free-form objects with patches, tangents and combined techniques.

## ADDED Requirements

### Requirement: Intent to tool map
The skill and `modelling_guide` SHALL contain a map from modelling intent to tool that covers every command of Plasticity's modelling menu, including Curve Array, Join / Unjoin, Hollow, Thicken, Pipe, Patch, Offset Curve, Raise Degree, Rebuild, Project, Imprint, Complete Edge, Draft Face and Match Face.

#### Scenario: Every named tool exists
- **WHEN** the catalog test reads the guide text and its topics
- **THEN** every tool name it mentions is a tool of the server

### Requirement: Free-form surfacing method
The rules SHALL describe building a free-form body from a curve network. They SHALL cover control-polygon splines for tangency, patches with continuity, loft between edges with clamped tangency, sweeps with rails and joining Sheets into a Solid, and say when a loft through sections is still the right choice.

#### Scenario: Topic served to a local model
- **WHEN** `modelling_guide` is called with `topic: "surfacing"`
- **THEN** the answer contains the method and the tool names it uses, and the base guide text names this topic

### Requirement: Combined techniques
The rules SHALL give recipes that combine techniques, each proven on a test object. The recipes SHALL include: revolve plus join for a tangent nose; union then a G2 root blend for fins and wings; three-view intersection for a quick body; removing loft end caps and patching them with continuity.

#### Scenario: Recipe order for blended junctions
- **WHEN** the rules describe a fin or wing junction
- **THEN** they put the union first, the root blend second and the outer edges last

### Requirement: Seam and size checks
The rules SHALL say to check seams with `measure_continuity`, to pick sharp edges by their measured angle before filleting, and to check the size of free-form bodies with a boolean or a section instead of bounds.

#### Scenario: Picking edges to round
- **WHEN** a body has both sharp and already tangent edges
- **THEN** the rules direct filleting only the edges measured G0 above a few degrees

### Requirement: Licence boundary
The rules SHALL NOT recommend Studio-only surfacing commands; they SHALL state that the server targets the Indie licence.

#### Scenario: N-sided opening
- **WHEN** an opening has three or five sides
- **THEN** the rules recommend `patch` with continuity, not an xNURBS command
