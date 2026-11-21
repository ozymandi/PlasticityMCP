# Spec Delta

## Purpose

Defines how promo scenes for PlasticityMCP are prepared on the laptop, previewed for the edit, and rendered frame by frame on Google Colab, so that the final frames drop into an approved edit without retiming.

## ADDED Requirements

### Requirement: Tessellation set per part
Each body exported from Plasticity into a promo scene SHALL carry its own tessellation setting, chosen by how close the camera gets to it. Parts seen in a close-up SHALL show no visible facets on curved surfaces at 1920 × 1080; parts never seen closer than the orbit MAY stay coarser.

#### Scenario: Close-up part is smooth
- **WHEN** a detail fly-through frame of a curved part is rendered at 1920 × 1080
- **THEN** its silhouette and reflections show no visible polygon edges

#### Scenario: Background part stays light
- **WHEN** a part never appears closer than the 360° orbit
- **THEN** its tessellation is coarser than that of the close-up parts, and the scene's triangle count is recorded

### Requirement: Self-contained scenes
A scene handed to Colab SHALL open and render on headless Linux Blender of the same version as the laptop without any file outside the .blend. Textures SHALL be packed and no path SHALL point at a Windows drive.

#### Scenario: Scene opens on Linux
- **WHEN** the approved .blend is opened by headless Blender 5.3 on Colab
- **THEN** it reports no missing files and renders a frame identical in content to the laptop test frame of the same frame number

### Requirement: Shots at 24 fps with fixed frame ranges
Every 3D shot SHALL run at 24 fps, 1920 × 1080, and SHALL own a named, fixed frame range in its scene (detail fly-throughs and one 360° orbit per object). After the edit is approved, camera motion and frame ranges SHALL NOT change; light and materials MAY.

#### Scenario: Shot list is readable
- **WHEN** the scene is inspected
- **THEN** each shot has a name, a camera, a start frame and an end frame, and the scene frame rate is 24

#### Scenario: Ranges locked after approval
- **WHEN** the edit has been approved
- **THEN** a final render of a shot produces exactly as many frames as its preview clip had

### Requirement: Previews match final frames
For every shot a preview clip SHALL be produced on the laptop with the same camera, frame range and frame rate as the final render, so the edit can be built and approved before the final render.

#### Scenario: Preview replaced without retiming
- **WHEN** the final PNG sequence of a shot replaces its preview in the After Effects project
- **THEN** the layer keeps its in point, out point and duration, and no cut in the edit moves

### Requirement: Resumable frame rendering on Colab
The final render SHALL run headless on Colab, one shot at a time, writing one PNG per frame into the configured output folder on Google Drive. A restarted run SHALL skip frames that already exist, so a lost session costs at most the frame in progress.

#### Scenario: Session dies mid-shot
- **WHEN** a Colab session stops after frame N of a shot and the same render is started again
- **THEN** rendering continues from the first missing frame and the finished sequence has no gaps or duplicates

#### Scenario: Output lands on the drive
- **WHEN** a shot finishes
- **THEN** its frames are in its own folder under the configured Drive output path, named by frame number

### Requirement: Render order
Final rendering SHALL start only after the Designer approves the edit, and SHALL render the Maserati scene before the boat scene.

#### Scenario: No final render before approval
- **WHEN** the edit has not been approved
- **THEN** no final-quality Colab render is started; only laptop test frames and previews exist

### Requirement: Curvature capture
Each object SHALL have a capture that shows its surface quality: a zebra or curvature view recorded from Plasticity or Blender, and a view in which the mesh density visibly follows curvature.

#### Scenario: Capture available for the edit
- **WHEN** the edit is assembled
- **THEN** each object has at least one curvature / zebra clip and one mesh-density clip at 24 fps or conformed to 24 fps without visible stutter
