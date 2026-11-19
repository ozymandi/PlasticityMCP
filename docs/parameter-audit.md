# Factory parameter audit — server vs Plasticity 26.1.3 (2026-11-19)

Generated from the live app (every *Factory: setters and instance fields) and matched against `factory.X =` assignments in `mcp-server/src/native/*.ts`. Approximate: a field set in another way can be listed as unused. Codes after `=` are the native defaults; enum names are in `surfacing-spike.md`.

```
AlignVertexFactory [curve-edit.ts]
    sets: moving target continuity
    UNUSED: t analysis tensions1=array
BooleanFactory [solids.ts]
    sets: targets tools operationType keepTools
    UNUSED: mode angle updatePivotMode transformOrientation transformPivot constructionPlane degrees tool targetMaterial=22832 toolMaterial=22832 completeTarget=22780 completeTool=22780 transform phantomStrategy
BridgeEdgeFactory [curve-edit.ts]
    sets: startCurvature endCurvature edge1 edge2
    UNUSED: lockDistances analysis tensions1=array tensions2=array side1=false side2=false
BridgeSurfaceFactory [surfaces.ts]
    sets: shape width softness
    UNUSED: propagationDegrees propagate=true trimWalls=true trimBlend=17402 sense1=undefined sense2=undefined propagationAngle=0 i=0 visitedFaces
BridgeVertexFactory [curve-edit.ts]
    sets: startCurvature endCurvature vertex1 vertex2
    UNUSED: lockDistances analysis tensions1=array tensions2=array
CapHolesInSheetFactory [solids.ts]
    sets: sheets
    UNUSED: -
CenterCircleFactory [curves.ts]
    sets: -
    UNUSED: radius center point orientation mode=0
ConstrainedSurfaceFactory [surfaces.ts]
    sets: points normals tolerance optimize
    UNUSED: angularToleranceDegrees angularTolerance=0.0872664626
ConvertVertexFactory [curve-edit.ts]
    sets: -
    UNUSED: vertices
CreateCurveFromEdgesFactory [curve-edit.ts,projection.ts]
    sets: edges
    UNUSED: -
CreateInstanceFactory [instances.ts,transforms.ts]
    sets: -
    UNUSED: items groups state
CreateOutlineFromShellsFactory [projection.ts]
    sets: shells
    UNUSED: -
CreateSheetFromFacesFactory [faces.ts]
    sets: -
    UNUSED: -
CreateSolidFromFacesFactory [faces.ts]
    sets: shell
    UNUSED: -
CurveArrayFactory [transforms.ts]
    sets: items curve num alignment twistDegrees scale distance shouldMakeInstances
    UNUSED: empties state helper scratchPartition orientations distanceMethod=24881 step=0 twist=0
CurveDuplicateFactory [transforms.ts,projection.ts]
    sets: -
    UNUSED: -
CurveFactory [curves.ts]
    sets: points type splineThrough closed
    UNUSED: -
CurveLoftFactory [profiles.ts]
    sets: guides closed profiles join
    UNUSED: curvature startMagnitude=1 endMagnitude=1 simplify=true trimGuides=true trimProfiles=true
DeformCurveFactory [curve-edit.ts]
    sets: sourceFace targetFace keepTools
    UNUSED: reblend=false flipUV=false flipNormal=false mirror=false scaleU=1 scaleV=1 scaleNormal=1 offsetU=0 offsetV=0 offsetNormal=0
DeformFaceFactory [surfaces.ts]
    sets: faces sourceFace targetFace keepTools
    UNUSED: grow=24122 reblend=false flipUV=false flipNormal=false mirror=false scaleU=1 scaleV=1 scaleNormal=1 offsetU=0 offsetV=0 offsetNormal=0
DeleteControlPointFactory [curve-edit.ts]
    sets: curve
    UNUSED: vertices cvs
DeleteEdgeFactory [faces.ts]
    sets: -
    UNUSED: -
DeleteFaceFactory [solids.ts]
    sets: -
    UNUSED: -
DissolveFaceFactory [solids.ts]
    sets: -
    UNUSED: -
DraftFaceFactory [solids.ts]
    sets: reference degrees
    UNUSED: grow=24122 normal angle=0 offset=0 method=21847
ExchangeImportFactory [exchange.ts]
    sets: -
    UNUSED: healOrientations=false healing=false computeAccurateEdges=false mergeEntities=false disjoinIfFaceFaceError=false sew=false sewingTolerance=0.0001
ExportCadFactory [exchange.ts]
    sets: items
    UNUSED: state saveAnalyticsToNurbs=false stepFormat=0
ExportHiddenLineFactory [exchange.ts]
    sets: items includeBackgroundImage useMaterialColors
    UNUSED: camera state instances=array devicePixelRatio=1 curveChordTolerance=0.0002 curveChordAngleDegrees=5 backgroundPixelScale=2 visibleStrokeWidth=0.5 hiddenStrokeWidth=0.25 silhouetteStrokeWidth=0.5 smoothStrokeWidth=0.25 hiddenDashLength=3 hiddenDashGap=1.5 useGridViews=false selectedViews planarSpacing=0 planarAxis sectionPlanarSpacing=0.1 sectionPlanarAxis radialAround=0 radialAlong=0 radialAbout=0 paramU=0 paramV=0 hasHiddenLines=true hasPlanarHatching=false hasSectionHatching=false capture generator writer
ExtendSheetFactory [faces.ts]
    sets: edges distance shape
    UNUSED: bias=0.5 type=22760 modify=true limit=23800
ExtrudeFactory [profiles.ts,solids.ts]
    sets: distance1 faces targets
    UNUSED: thickness individual degrees1 degrees2 state directionMode="one-direction" lockDistances=false distance2=0 angle1=0 angle2=0 thickness1=0 thickness2=0
FilletCurveFactory [curve-edit.ts]
    sets: radius curves
    UNUSED: -
FilletShellFactory [solids.ts]
    sets: shell edges distance
    UNUSED: filletMode chamferMode prolong lockDistances distance1 distance2 agent="automatic" shape=22201 yBlend=false rho=0.5
FilletVertexFactory [curve-edit.ts]
    sets: radius
    UNUSED: vertices
HollowFacesFactory [solids.ts]
    sets: faces thickness
    UNUSED: local=false grow=24122
HollowSolidsFactory [solids.ts]
    sets: thickness solids
    UNUSED: local=false grow=24122
ImprintBodyBodyFactory [faces.ts]
    sets: target tools completeTarget imprintTool completeTool
    UNUSED: -
ImprintCurveBodyFactory [faces.ts]
    sets: target curves complete method
    UNUSED: isAlignedView bidirectional=true occlude=true
IsoparamFactory [faces.ts]
    sets: shell face uOrV paramPoint count
    UNUSED: paramField=undefined subdivide=false face2copy
JoinCurvesFactory [curves.ts]
    sets: curves
    UNUSED: -
JoinFacesFactory [faces.ts]
    sets: shell
    UNUSED: -
JoinSheetsFactory [solids.ts]
    sets: sheets
    UNUSED: -
KnifeCenterPointArcFactory [curves.ts]
    sets: isKnife lastSense
    UNUSED: angle radius center p2 p3 orientation lastQuadrant=0
KnifeEllipseFactory [curves.ts]
    sets: isKnife
    UNUSED: majorRadius minorRadius center point1 point2 orientation mode=0
KnifePolygonFactory [curves.ts]
    sets: isKnife circumscribedOrInscribed vertexCount
    UNUSED: radius verticalOrHorizontal=0 center point orientation
KnifeThreePointCircleFactory [curves.ts]
    sets: isKnife
    UNUSED: radius p1 p2 p3 precalcPartition
KnifeTwoPointCircleFactory [curves.ts]
    sets: isKnife
    UNUSED: radius diameter center point orientation mode=0 p1 p2
MatchFaceFactory [faces.ts]
    sets: replacement
    UNUSED: grow=24122 sense=false
MeasureContinuityFactory [measure.ts]
    sets: continuity edges
    UNUSED: g1ToleranceDegrees state g0Scale=10 g1Scale=10 g2Scale=0.1 curvatureScale=0.1 g0Tolerance=0.00001 g1Tolerance=0.0017453293 g2Tolerance=0.05 continuities=array
MeshImportFactory [exchange.ts]
    sets: unit
    UNUSED: filePath state
MirrorFactory [transforms.ts]
    sets: shells curves shouldCut shouldUnion
    UNUSED: origin normal move empties face state helper shouldMakeInstances=false strategy
MoveEdgeFactory [faces.ts]
    sets: -
    UNUSED: degrees angle constructionPlane transformOrientation transformPivot transforms=array pivot quaternion updatePivotMode=0 mode="move" move scale rotation
MoveItemAndEmptyFactory [instances.ts,curves.ts,transforms.ts]
    sets: items
    UNUSED: degrees angle empties constructionPlane transformOrientation transformPivot state transforms=array pivot quaternion updatePivotMode=0 steps orientations shouldTransformInstancesInversely=false mode="move" move scale rotation
MultiCurveCutFactory [curve-edit.ts]
    sets: targets curves
    UNUSED: shouldExtend=false isAlignedView=false
MultiCutFactory [solids.ts]
    sets: shells curves shouldExtend faces
    UNUSED: isAlignedView=false
MultiExtendVertexFactory [curve-edit.ts]
    sets: distance shape
    UNUSED: vertices type=23081 tracking=array
MultiMoveControlPointFactory [curve-edit.ts]
    sets: -
    UNUSED: proportional falloffExponentU falloffExponentV lockFalloff mirrorMode degrees angle constructionPlane transformOrientation transformPivot cvs vertices proportionalPivot transforms=array pivot quaternion updatePivotMode=0 mode="move" move scale rotation normal ref
MultiMoveFaceFactory [faces.ts]
    sets: -
    UNUSED: degrees angle step constructionPlane transformOrientation transformPivot grow=24122 transforms=array pivot quaternion updatePivotMode=0 mode="move" move scale rotation
MultiPlanarizingBasicScaleFaceFactory [faces.ts]
    sets: -
    UNUSED: degrees angle step constructionPlane transformOrientation transformPivot grow=24122 transforms=array pivot quaternion updatePivotMode=0 mode="scale" move scale rotation
MultiRotateControlPointFactory [curve-edit.ts]
    sets: -
    UNUSED: degrees angle constructionPlane transformOrientation transformPivot cvs vertices proportionalPivot transforms=array pivot quaternion updatePivotMode=0 mode="rotate" move scale rotation
MultiRotateFaceFactory [faces.ts]
    sets: -
    UNUSED: degrees angle step constructionPlane transformOrientation transformPivot grow=24122 transforms=array pivot quaternion updatePivotMode=0 mode="rotate" move scale rotation
MultiScaleControlPointFactory [curve-edit.ts]
    sets: -
    UNUSED: degrees angle constructionPlane transformOrientation transformPivot cvs vertices proportionalPivot transforms=array pivot quaternion updatePivotMode=0 mode="scale" move scale rotation
MultiSlideControlPointFactory [curve-edit.ts]
    sets: distance
    UNUSED: cvs vertices proportionalPivot directions=array distances=array
OBJExportFactory [exchange.ts]
    sets: -
    UNUSED: empties planeAngleDegrees convex curveChordTolerance surfacePlaneTolerance lockPlaneTolerance curveChordAngle curveChordAngleDegrees surfacePlaneAngle surfacePlaneAngleDegrees lockAngleTolerance density maxSides maxWidth curveChordMax unit="meter" showWireframe=true simplify=false scale=1 upAxis="z" planeTolerance=0 planeAngle=0 minWidth=0 matchTopology=true shape=20501 inflect=false ignoreWidth=0 exporter
OffsetEdgeFactory [faces.ts]
    sets: distance lockDistances gapFill
    UNUSED: -
OffsetFaceFactory [faces.ts]
    sets: distance
    UNUSED: reference degrees grow=24122 angle=0
OffsetFaceLoopFactory [faces.ts]
    sets: distance lockDistances gapFill
    UNUSED: isIndividual=true
OffsetPlanarCurvesFactory [curve-edit.ts]
    sets: distance1 lockDistances distance2 gapFill
    UNUSED: constructionPlane isAlignedView=false isPointMode=false point
OffsetRegionFactory [curve-edit.ts]
    sets: sketch regions distance1 gapFill
    UNUSED: isIndividual=true distance2=0 lockDistances=false
OffsetVertexFactory [curve-edit.ts]
    sets: distance
    UNUSED: vertices
ParasolidImportFactory [exchange.ts]
    sets: -
    UNUSED: -
PatchHoleInSheetFactory [solids.ts]
    sets: curves sheet edges
    UNUSED: guides continuity internalSmoothness=24910 topology=22740 tolerance=0.00001
PatchHoleInSolidFactory [solids.ts]
    sets: edges
    UNUSED: fillPreference=22370 internalSmoothness=24910 continuity=23153 topology=22740 tolerance=0.00001
PatchHoleInWireFactory [solids.ts]
    sets: curves
    UNUSED: fillPreference=22370 internalSmoothness=24910 continuity=23153 topology=22740 tolerance=0.00001
PatchRegionFactory [solids.ts]
    sets: regions
    UNUSED: fillPreference=22370 internalSmoothness=24910 continuity=23153 topology=22740 tolerance=0.00001
PipeFactory [solids.ts]
    sets: spines diameter thickness
    UNUSED: distance1 distance2 extensionShape twistDegrees degrees vertexCount state scale=1 twist=0 angle=0
PlanarizeCurveFactory [projection.ts]
    sets: -
    UNUSED: normal cross
PointToPointMeasurementFactory [measure.ts]
    sets: isAxisAligned
    UNUSED: start end offset orientation previousAxisOfMeasurement
PossiblyBooleanCylinderFactory [primitives.ts]
    sets: radius height
    UNUSED: center point orientation mode=0 booleanPhantoms
PossiblyBooleanSphereFactory [primitives.ts]
    sets: radius
    UNUSED: center point booleanPhantoms
ProjectBodyBodyFactory [projection.ts]
    sets: target tools
    UNUSED: -
ProjectCurveBodyFactory [projection.ts]
    sets: target curves method
    UNUSED: isAlignedView complete=25340 bidirectional=true occlude=true
ProjectCurveCurveFactory [projection.ts]
    sets: curve1 curve2
    UNUSED: extrude1 extrude2 isAlignedView=false
ProjectOutlineFromShellsFactory [projection.ts]
    sets: shells
    UNUSED: -
ProjectingScaleItemAndEmptyFactory [transforms.ts]
    sets: items
    UNUSED: degrees angle empties constructionPlane transformOrientation transformPivot state transforms=array pivot quaternion updatePivotMode=0 steps orientations shouldTransformInstancesInversely=false mode="scale" move scale rotation project
RadialArrayFactory [transforms.ts]
    sets: items center mode num1 num2 angle shouldMakeInstances
    UNUSED: degrees empties state helper step1=0
RadialMeasurementFactory [measure.ts]
    sets: snap
    UNUSED: end
RaiseDegreeCurveFactory [curve-edit.ts]
    sets: -
    UNUSED: -
RaiseDegreeFaceFactory [surfaces.ts]
    sets: deltaUDegree deltaVDegree
    UNUSED: grow=24122
RealizeInstanceFactory [instances.ts,transforms.ts]
    sets: -
    UNUSED: empties state
RebuildCurveFactory [curve-edit.ts]
    sets: keepCorners
    UNUSED: method=0 preserveParameterization=false tolerance=0.001 preserveChain=true pointCount=10 degree=5 spans=1 fairnessWeight=0.5
RebuildFaceFactory [surfaces.ts]
    sets: shell face method tolerance changeEdgeMethod
    UNUSED: rebuild=undefined uDegree=3 vDegree=3 uSpans=1 vSpans=1 uExtend=0 vExtend=0 shrink=false grow=24122
RectangularArrayFactory [transforms.ts]
    sets: items mode num1 num2 distance1 distance2 shouldMakeInstances
    UNUSED: empties state helper
RefilletFaceFactory [faces.ts]
    sets: mode distance
    UNUSED: grow=24122
RegionLoftFactory [profiles.ts]
    sets: regions guides closed
    UNUSED: startMagnitude=1 endMagnitude=1 simplify=true trimGuides=true startCurvature=21531 endCurvature=21531
RemoveFilletsFromShellFactory [solids.ts]
    sets: shells radius convexity
    UNUSED: -
RemoveNominalSurfaceFactory [surfaces.ts]
    sets: shell
    UNUSED: -
ReverseCurveFactory [faces.ts]
    sets: curves
    UNUSED: -
ReverseSheetFactory [faces.ts]
    sets: sheets
    UNUSED: -
RevolveFactory [profiles.ts]
    sets: degrees
    UNUSED: thickness twistDegrees guides state alignment=21560 guideMethod=23250 distance1=1 distance2=1 extensionShape=22750 simplify=false cornerType=25700 twist=0 scale=1 axis angle=6.283185307179586
RotateItemAndEmptyFactory [curves.ts,transforms.ts]
    sets: items
    UNUSED: degrees angle empties constructionPlane transformOrientation transformPivot state transforms=array pivot quaternion updatePivotMode=0 steps orientations shouldTransformInstancesInversely=false mode="rotate" move scale rotation
STLExportFactory [exchange.ts]
    sets: -
    UNUSED: empties planeAngleDegrees convex curveChordTolerance surfacePlaneTolerance lockPlaneTolerance curveChordAngle curveChordAngleDegrees surfacePlaneAngle surfacePlaneAngleDegrees lockAngleTolerance density maxSides maxWidth curveChordMax unit="meter" showWireframe=true simplify=false scale=1 upAxis="z" planeTolerance=0 planeAngle=0 minWidth=0 matchTopology=true shape=20501 inflect=false ignoreWidth=0 exporter
SectionAnalysisFactory [measure.ts]
    sets: -
    UNUSED: flip which degrees1 degrees2 state previous=undefined section distance=0 angle1=0 angle2=0
SlotFactory [curves.ts]
    sets: width
    UNUSED: distance1
SpiralFactory [curves.ts]
    sets: p2 turns spiralPitch handedness
    UNUSED: length angle degrees
SubdivideCurveFactory [curve-edit.ts]
    sets: -
    UNUSED: -
SweepFactory [profiles.ts]
    sets: spine twistDegrees scale
    UNUSED: thickness guides state alignment=21560 guideMethod=23250 distance1=1 distance2=1 extensionShape=22750 simplify=false cornerType=25700 twist=0
TangentArcFactory [curves.ts]
    sets: segment flipTangent
    UNUSED: point1 point2
TangentCircleFactory [curves.ts]
    sets: segment1 segment2 radius
    UNUSED: point isFrozen=false normal center previousSolution
TextFactory [curves.ts]
    sets: -
    UNUSED: text="Plasticity" font="inter" size=10
ThickenFaceFactory [solids.ts]
    sets: front back
    UNUSED: lockDistances=false
ThickenSheetFactory [solids.ts]
    sets: front back sheets
    UNUSED: lockDistances=false
ThreeMfExportFactory [exchange.ts]
    sets: -
    UNUSED: empties planeAngleDegrees convex curveChordTolerance surfacePlaneTolerance lockPlaneTolerance curveChordAngle curveChordAngleDegrees surfacePlaneAngle surfacePlaneAngleDegrees lockAngleTolerance density maxSides maxWidth curveChordMax unit="meter" showWireframe=true simplify=false scale=1 upAxis="z" planeTolerance=0 planeAngle=0 minWidth=0 matchTopology=true shape=20501 inflect=false ignoreWidth=0 exporter
ThreePointBoxFactory [primitives.ts]
    sets: p1 p2 p3 p4
    UNUSED: -
ThreePointRectangleFactory [curves.ts]
    sets: -
    UNUSED: width length cross
TrimFactory [curve-edit.ts]
    sets: segments
    UNUSED: segment infos
UnjoinCurvesFactory [solids.ts]
    sets: curves
    UNUSED: -
UnjoinFacesFactory [solids.ts]
    sets: -
    UNUSED: -
UnjoinShellsFactory [solids.ts]
    sets: shells
    UNUSED: -
UntrimFactory [faces.ts]
    sets: keepEdges
    UNUSED: -
UnwrapFactory [faces.ts]
    sets: -
    UNUSED: -
VectorImportFactory [exchange.ts]
    sets: unit
    UNUSED: filePath```
