import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NativeSession } from "./native.js";
import { Vec3 } from "./native/types.js";
import { Resvg } from "@resvg/resvg-js";

const EXAMPLES_DIR = "E:\\Projects\\PlasticityMCP\\examples\\nintendo-nes";
const DRAWINGS_DIR = join(EXAMPLES_DIR, "drawings");

if (!existsSync(DRAWINGS_DIR)) {
  mkdirSync(DRAWINGS_DIR, { recursive: true });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== NINTENDO ENTERTAINMENT SYSTEM (NES) CAD BUILDER ===");
  const native = new NativeSession();
  await native.connect();
  console.log("Connected to Plasticity.");

  // Clean document
  await native.newDocument(true);
  const baseline = await native.state();
  if (baseline.bodies.length > 0) {
    await native.deleteBodies(baseline.bodies.map((b) => b.id));
  }
  console.log("Document initialized clean.");

  // Materials
  console.log("Creating Materials...");
  const matLightGray = await native.createMaterial({
    name: "NES Light Gray",
    color: "#C5C6C7",
    roughness: 0.45,
    metalness: 0.05,
    opacity: 1.0,
  });
  const matDarkCharcoal = await native.createMaterial({
    name: "NES Dark Charcoal",
    color: "#2B2C2E",
    roughness: 0.5,
    metalness: 0.08,
    opacity: 1.0,
  });
  const matNintendoRed = await native.createMaterial({
    name: "Nintendo Red",
    color: "#D82800",
    roughness: 0.35,
    metalness: 0.02,
    opacity: 1.0,
  });
  const matCartridgeGray = await native.createMaterial({
    name: "Cartridge Dark Gray",
    color: "#4B4C4F",
    roughness: 0.55,
    metalness: 0.05,
    opacity: 1.0,
  });
  const matGold = await native.createMaterial({
    name: "Contact Gold",
    color: "#E5B83B",
    roughness: 0.2,
    metalness: 0.9,
    opacity: 1.0,
  });
  const matChrome = await native.createMaterial({
    name: "Chrome Metal",
    color: "#D0D2D6",
    roughness: 0.15,
    metalness: 0.95,
    opacity: 1.0,
  });
  const matRubber = await native.createMaterial({
    name: "Black Rubber",
    color: "#18181A",
    roughness: 0.85,
    metalness: 0.0,
    opacity: 1.0,
  });
  const matPcbGreen = await native.createMaterial({
    name: "PCB Laminate",
    color: "#1B5E20",
    roughness: 0.4,
    metalness: 0.1,
    opacity: 1.0,
  });

  const consoleBodies: number[] = [];
  const cartridgeBodies: number[] = [];
  const ctrl1Bodies: number[] = [];
  const ctrl2Bodies: number[] = [];
  const cableBodies: number[] = [];

  // ==========================================
  // 1. CONSOLE LOWER CHASSIS & DETAILS
  // ==========================================
  console.log("Modeling Console Lower Chassis...");
  // Base plinth: 256 mm (X) x 202 mm (Y) x 42 mm (Z)
  const baseBox = (await native.createBox([-128, -101, 0], [256, 202, 42], "nes_lower_chassis")).created[0]!;
  let lowerChassisId = baseBox.id;

  // Front step cut: depth 26 mm, height from Z=26 to 43 mm
  const stepCut = (await native.createBox([-129, -102, 26], [258, 28, 18], "step_cutter")).created[0]!;
  const cutRes = await native.boolean("difference", [lowerChassisId], [stepCut.id]);
  lowerChassisId = cutRes.created[0]?.id ?? cutRes.changed[0]!.id;

  // Port 1 Cavity
  const port1Cut = (await native.createBox([-57, -102, 10], [18, 14, 14], "port1_cut")).created[0]!;
  const p1Res = await native.boolean("difference", [lowerChassisId], [port1Cut.id]);
  lowerChassisId = p1Res.created[0]?.id ?? p1Res.changed[0]!.id;

  // Port 2 Cavity
  const port2Cut = (await native.createBox([-25, -102, 10], [18, 14, 14], "port2_cut")).created[0]!;
  const p2Res = await native.boolean("difference", [lowerChassisId], [port2Cut.id]);
  lowerChassisId = p2Res.created[0]?.id ?? p2Res.changed[0]!.id;

  // Power & Reset Bay Cavity
  const btnBayCut = (await native.createBox([-116, -102, 10], [48, 8, 16], "button_bay_cut")).created[0]!;
  const bBayRes = await native.boolean("difference", [lowerChassisId], [btnBayCut.id]);
  lowerChassisId = bBayRes.created[0]?.id ?? bBayRes.changed[0]!.id;

  // Side AV Cavity on Right Panel (X = +128)
  const avBayCut = (await native.createBox([122, 20, 12], [8, 48, 20], "av_bay_cut")).created[0]!;
  const avRes = await native.boolean("difference", [lowerChassisId], [avBayCut.id]);
  lowerChassisId = avRes.created[0]?.id ?? avRes.changed[0]!.id;

  consoleBodies.push(lowerChassisId);
  await native.setMaterial([lowerChassisId], matDarkCharcoal.id);

  // Controller Port 1 & 2 D-sub socket bezels & pins
  console.log("Modeling Controller Ports...");
  for (const [pIdx, xPos] of [[1, -48], [2, -16]] as const) {
    const socketBlock = (await native.createBox([xPos - 7.5, -99, 11], [15, 10, 12], `port_${pIdx}_socket`)).created[0]!;
    consoleBodies.push(socketBlock.id);
    await native.setMaterial([socketBlock.id], matDarkCharcoal.id);

    // 7 contact pins per port
    const pinOffsets: [number, number][] = [
      [-4.5, 18], [-1.5, 18], [1.5, 18], [4.5, 18],
      [-3.0, 14], [0.0, 14], [3.0, 14]
    ];
    for (let i = 0; i < pinOffsets.length; i++) {
      const [ox, oz] = pinOffsets[i]!;
      const pin = (await native.createCylinder([xPos + ox, -100, oz], 0.45, 6, [0, 1, 0], `port_${pIdx}_pin_${i}`)).created[0]!;
      consoleBodies.push(pin.id);
      await native.setMaterial([pin.id], matGold.id);
    }
  }

  // Power & Reset Buttons & LED
  console.log("Modeling Buttons & Indicators...");
  const powerBtn = (await native.createBox([-112, -102.5, 12], [15, 9, 12], "nes_power_button")).created[0]!;
  const resetBtn = (await native.createBox([-82, -102.5, 12], [12, 9, 12], "nes_reset_button")).created[0]!;
  const ledJewel = (await native.createBox([-94, -102.5, 15], [6, 7, 6], "nes_power_led")).created[0]!;

  consoleBodies.push(powerBtn.id, resetBtn.id, ledJewel.id);
  await native.setMaterial([powerBtn.id, resetBtn.id], matDarkCharcoal.id);
  await native.setMaterial([ledJewel.id], matNintendoRed.id);

  // AV Output Jacks (Yellow Video, Red Audio) on Right Panel
  console.log("Modeling Side AV Jacks...");
  for (const [avIdx, yPos, colorMat, name] of [
    [1, 32, matGold, "rca_video"],
    [2, 52, matNintendoRed, "rca_audio"]
  ] as const) {
    const sleeve = (await native.createCylinder([124, yPos, 22], 4.15, 6, [1, 0, 0], `${name}_sleeve`)).created[0]!;
    const core = (await native.createCylinder([127, yPos, 22], 3.2, 4, [1, 0, 0], `${name}_core`)).created[0]!;
    const jack = (await native.createCylinder([129, yPos, 22], 1.6, 3, [1, 0, 0], `${name}_pin`)).created[0]!;
    consoleBodies.push(sleeve.id, core.id, jack.id);
    await native.setMaterial([sleeve.id], matChrome.id);
    await native.setMaterial([core.id], colorMat.id);
    await native.setMaterial([jack.id], matGold.id);
  }

  // Rear I/O Panel (Y = +101)
  console.log("Modeling Rear Panel I/O...");
  const rfBox = (await native.createBox([-48, 98, 15], [20, 5, 16], "rf_modulator_box")).created[0]!;
  const rfJack = (await native.createCylinder([-38, 101, 23], 4.75, 9, [0, 1, 0], "rf_f_connector")).created[0]!;
  const chSwitch = (await native.createBox([-18, 99, 18], [12, 4, 8], "ch3_4_switch")).created[0]!;
  const pwrJack = (await native.createCylinder([22, 101, 22], 4.5, 7, [0, 1, 0], "ac_power_barrel")).created[0]!;
  const pwrPin = (await native.createCylinder([22, 101, 22], 1.0, 8, [0, 1, 0], "ac_power_center_pin")).created[0]!;
  consoleBodies.push(rfBox.id, rfJack.id, chSwitch.id, pwrJack.id, pwrPin.id);
  await native.setMaterial([rfBox.id, rfJack.id], matChrome.id);
  await native.setMaterial([chSwitch.id, pwrJack.id], matDarkCharcoal.id);
  await native.setMaterial([pwrPin.id], matGold.id);

  // Underside Feet & Screws
  console.log("Modeling Feet & Chassis Screws...");
  const feetPos: [number, number][] = [[-105, -78], [105, -78], [-105, 78], [105, 78]];
  for (let i = 0; i < feetPos.length; i++) {
    const [fx, fy] = feetPos[i]!;
    const foot = (await native.createCylinder([fx, fy, -3], 8, 3, [0, 0, 1], `rubber_foot_${i + 1}`)).created[0]!;
    consoleBodies.push(foot.id);
    await native.setMaterial([foot.id], matRubber.id);
  }

  const screwPos: [number, number][] = [
    [-95, -65], [95, -65], [-95, 0], [95, 0], [-95, 65], [95, 65]
  ];
  for (let i = 0; i < screwPos.length; i++) {
    const [sx, sy] = screwPos[i]!;
    const screw = (await native.createCylinder([sx, sy, 0.5], 2.8, 1.2, [0, 0, 1], `chassis_screw_${i + 1}`)).created[0]!;
    consoleBodies.push(screw.id);
    await native.setMaterial([screw.id], matChrome.id);
  }

  // ==========================================
  // 2. CONSOLE UPPER SHELL, FLAP & LOUVERS
  // ==========================================
  console.log("Modeling Console Upper Housing...");
  const upperBox = (await native.createBox([-128, -101, 42], [256, 202, 47], "nes_upper_chassis")).created[0]!;
  let upperChassisId = upperBox.id;

  // Cartridge flap door cut / cavity
  const flapCavityCut = (await native.createBox([-118, -102, 48], [138, 14, 37], "flap_bay_cut")).created[0]!;
  const flRes = await native.boolean("difference", [upperChassisId], [flapCavityCut.id]);
  upperChassisId = flRes.created[0]?.id ?? flRes.changed[0]!.id;

  // Vent grille recess on top right
  const ventRecessCut = (await native.createBox([28, -48, 86.5], [92, 126, 3.5], "vent_recess_cut")).created[0]!;
  const ventCutRes = await native.boolean("difference", [upperChassisId], [ventRecessCut.id]);
  upperChassisId = ventCutRes.created[0]?.id ?? ventCutRes.changed[0]!.id;

  consoleBodies.push(upperChassisId);
  await native.setMaterial([upperChassisId], matLightGray.id);

  // Cartridge Loading Flap Door
  console.log("Modeling Cartridge Door Flap...");
  const doorFlap = (await native.createBox([-117, -101, 49], [136, 6, 35], "cartridge_door_flap")).created[0]!;
  // Molded badge stripe on door
  const doorBadge = (await native.createBox([-110, -101.8, 64], [122, 1.2, 5], "door_nintendo_badge")).created[0]!;
  // Bottom finger-lift groove
  const fingerLift = (await native.createBox([-80, -102, 49], [62, 3, 3], "door_finger_lift")).created[0]!;

  consoleBodies.push(doorFlap.id, doorBadge.id, fingerLift.id);
  await native.setMaterial([doorFlap.id], matDarkCharcoal.id);
  await native.setMaterial([doorBadge.id], matNintendoRed.id);
  await native.setMaterial([fingerLift.id], matDarkCharcoal.id);

  // Ventilation Louvers (12 cooling fins on top right)
  console.log("Modeling Louvers & Vents...");
  const ventBed = (await native.createBox([30, -46, 86.5], [88, 122, 1.5], "vent_bed")).created[0]!;
  consoleBodies.push(ventBed.id);
  await native.setMaterial([ventBed.id], matDarkCharcoal.id);

  for (let i = 0; i < 12; i++) {
    const yRib = -42 + i * 10;
    const rib = (await native.createBox([32, yRib, 87.5], [84, 4.5, 1.8], `cooling_louver_${i + 1}`)).created[0]!;
    consoleBodies.push(rib.id);
    await native.setMaterial([rib.id], matDarkCharcoal.id);
  }

  // ==========================================
  // 3. NES GAME CARTRIDGE (GAME PAK)
  // ==========================================
  console.log("Modeling NES Game Cartridge...");
  // Placed standing beside the console: X = 185, Y = -15, Z = 0
  const cartBody = (await native.createBox([125, -24.5, 0], [120, 19, 133], "game_pak_cartridge")).created[0]!;
  let cartId = cartBody.id;

  // Bottom edge connector slot cut
  const pcbSlotCut = (await native.createBox([132, -22, -1], [106, 14, 26], "pcb_slot_cut")).created[0]!;
  const cCut1 = await native.boolean("difference", [cartId], [pcbSlotCut.id]);
  cartId = cCut1.created[0]?.id ?? cCut1.changed[0]!.id;

  // Front label recess cut
  const labelRecessCut = (await native.createBox([142, -25.2, 18], [86, 1.5, 88], "label_recess_cut")).created[0]!;
  const cCut2 = await native.boolean("difference", [cartId], [labelRecessCut.id]);
  cartId = cCut2.created[0]?.id ?? cCut2.changed[0]!.id;

  // 5 Top Finger Grip Grooves
  for (let i = 0; i < 5; i++) {
    const zGrip = 114 + i * 3.8;
    const gripCut = (await native.createBox([124, -25.5, zGrip], [122, 2.2, 2.0], `cart_grip_cut_${i}`)).created[0]!;
    const gCut = await native.boolean("difference", [cartId], [gripCut.id]);
    cartId = gCut.created[0]?.id ?? gCut.changed[0]!.id;
  }

  cartridgeBodies.push(cartId);
  await native.setMaterial([cartId], matCartridgeGray.id);

  // Label Artwork Inset Plate
  const labelPlate = (await native.createBox([143, -24.8, 19], [84, 0.8, 86], "cart_label_plate")).created[0]!;
  // Molded "THIS SIDE OUT" Arrow
  const arrowWedge = (await native.createBox([182, -25.2, 108], [6, 0.8, 4], "cart_arrow_indicator")).created[0]!;

  // Internal PCB & Gold Connector Fingers
  const pcbBoard = (await native.createBox([134, -15.8, 4], [102, 1.6, 30], "cart_pcb_board")).created[0]!;
  cartridgeBodies.push(labelPlate.id, arrowWedge.id, pcbBoard.id);
  await native.setMaterial([labelPlate.id], matLightGray.id);
  await native.setMaterial([arrowWedge.id], matNintendoRed.id);
  await native.setMaterial([pcbBoard.id], matPcbGreen.id);

  // Gold Pins on PCB edge
  for (let i = 0; i < 16; i++) {
    const xPin = 138 + i * 5.8;
    const goldPinFront = (await native.createBox([xPin, -16.2, 4], [3.2, 0.5, 14], `pcb_pin_f_${i}`)).created[0]!;
    const goldPinBack = (await native.createBox([xPin, -14.3, 4], [3.2, 0.5, 14], `pcb_pin_b_${i}`)).created[0]!;
    cartridgeBodies.push(goldPinFront.id, goldPinBack.id);
    await native.setMaterial([goldPinFront.id, goldPinBack.id], matGold.id);
  }

  // 3 Security Screws on Cartridge
  for (const [sx, sz] of [[136, 12], [234, 12], [185, 126]] as const) {
    const sc = (await native.createCylinder([sx, -5.2, sz], 1.8, 1.2, [0, 1, 0], "cart_security_screw")).created[0]!;
    cartridgeBodies.push(sc.id);
    await native.setMaterial([sc.id], matChrome.id);
  }

  // ==========================================
  // 4. CONTROLLER 1 & CONTROLLER 2 (NES-004)
  // ==========================================
  console.log("Modeling Controller 1 & 2...");
  const ctrlConfigs = [
    { idx: 1, cx: -75, cy: -160, list: ctrl1Bodies, portX: -48 },
    { idx: 2, cx: 65, cy: -160, list: ctrl2Bodies, portX: -16 }
  ];

  for (const { idx, cx, cy, list, portX } of ctrlConfigs) {
    // Controller Shell: 123 mm x 53 mm x 17 mm
    const cBox = (await native.createBox([cx - 61.5, cy - 26.5, 0], [123, 53, 17], `controller_${idx}_shell`)).created[0]!;
    let ctrlId = cBox.id;

    // Recessed faceplate decal well: 117 x 47 x 0.8 mm
    const decalCut = (await native.createBox([cx - 58.5, cy - 23.5, 16.2], [117, 47, 1.5], `ctrl_${idx}_decal_cut`)).created[0]!;
    const dCut = await native.boolean("difference", [ctrlId], [decalCut.id]);
    ctrlId = dCut.created[0]?.id ?? dCut.changed[0]!.id;

    list.push(ctrlId);
    await native.setMaterial([ctrlId], matLightGray.id);

    // Dark Faceplate Decal Inset
    const decalPlate = (await native.createBox([cx - 58, cy - 23, 16.2], [116, 46, 0.4], `ctrl_${idx}_decal_plate`)).created[0]!;
    list.push(decalPlate.id);
    await native.setMaterial([decalPlate.id], matDarkCharcoal.id);

    // D-Pad Cross: centered at cx - 32, cy, Z = 16.5 to 19.5 mm
    const dpadX = (await native.createBox([cx - 32 - 11, cy - 3.8, 16.4], [22, 7.6, 3.2], `ctrl_${idx}_dpad_x`)).created[0]!;
    const dpadY = (await native.createBox([cx - 32 - 3.8, cy - 11, 16.4], [7.6, 22, 3.2], `ctrl_${idx}_dpad_y`)).created[0]!;
    const dpadUnion = await native.boolean("union", [dpadX.id], [dpadY.id]);
    const dpadId = dpadUnion.created[0]?.id ?? dpadUnion.changed[0]!.id;

    // Central thumb dish depression on D-pad
    const dish = (await native.createSphere([cx - 32, cy, 21.0], 4.5, `ctrl_${idx}_thumb_dish`)).created[0]!;
    const dishCut = await native.boolean("difference", [dpadId], [dish.id]);
    const finalDpadId = dishCut.created[0]?.id ?? dishCut.changed[0]!.id;

    list.push(finalDpadId);
    await native.setMaterial([finalDpadId], matDarkCharcoal.id);

    // SELECT & START Angled Rubber Pills
    for (const [bName, bX] of [["select", cx - 7], ["start", cx + 7]] as const) {
      const pill = (await native.createBox([bX - 4.5, cy - 1.8, 16.4], [9, 3.6, 2.2], `ctrl_${idx}_${bName}`)).created[0]!;
      list.push(pill.id);
      await native.setMaterial([pill.id], matRubber.id);
    }

    // Action Buttons B & A (Nintendo Red in angled bezel)
    const btnPod = (await native.createBox([cx + 20, cy - 7, 16.4], [32, 14, 0.4], `ctrl_${idx}_button_pod`)).created[0]!;
    list.push(btnPod.id);
    await native.setMaterial([btnPod.id], matDarkCharcoal.id);

    const btnB = (await native.createCylinder([cx + 27, cy, 16.4], 4.4, 3.0, [0, 0, 1], `ctrl_${idx}_btn_b`)).created[0]!;
    const btnA = (await native.createCylinder([cx + 43, cy, 16.4], 4.4, 3.0, [0, 0, 1], `ctrl_${idx}_btn_a`)).created[0]!;
    list.push(btnB.id, btnA.id);
    await native.setMaterial([btnB.id, btnA.id], matNintendoRed.id);

    // Nintendo Logo Accent Badge on Controller
    const badge = (await native.createBox([cx + 18, cy + 13, 16.5], [34, 4.5, 0.6], `ctrl_${idx}_badge`)).created[0]!;
    list.push(badge.id);
    await native.setMaterial([badge.id], matNintendoRed.id);

    // Strain Relief Boot on Controller Top Edge
    const boot1 = (await native.createCylinder([cx, cy + 26.5, 8.5], 3.2, 5, [0, 1, 0], `ctrl_${idx}_boot_outer`)).created[0]!;
    const boot2 = (await native.createCylinder([cx, cy + 31.5, 8.5], 2.4, 4, [0, 1, 0], `ctrl_${idx}_boot_inner`)).created[0]!;
    list.push(boot1.id, boot2.id);
    await native.setMaterial([boot1.id, boot2.id], matRubber.id);

    // Molded Cable running to Console Port
    console.log(`Modeling Controller ${idx} Cable & Console Plug...`);
    let cablePoints: Vec3[];
    if (idx === 1) {
      cablePoints = [
        [-75, -124.5, 8.5],
        [-72, -118, 6.0],
        [-64, -112, 5.0],
        [-54, -108, 11.0],
        [-48, -106, 16.0]
      ];
    } else {
      cablePoints = [
        [65, -124.5, 8.5],
        [55, -120, 6.0],
        [28, -114, 5.0],
        [-4, -109, 10.0],
        [-16, -106, 16.0]
      ];
    }
    const splineWire = (await native.createSpline(cablePoints, false, `ctrl_${idx}_cable_spine`)).created[0]!;
    const cableSolid = (await native.pipe([splineWire.id], 3.0)).created[0]!;
    await native.deleteBodies([splineWire.id]); // delete helper wire
    cableBodies.push(cableSolid.id);
    await native.setMaterial([cableSolid.id], matRubber.id);

    // Console End 7-pin Plug Connector Body
    const plugBody = (await native.createBox([portX - 7, -118, 10.5], [14, 15, 11], `ctrl_${idx}_console_plug`)).created[0]!;
    cableBodies.push(plugBody.id);
    await native.setMaterial([plugBody.id], matDarkCharcoal.id);
  }

  // ==========================================
  // 5. SCENE ORGANIZATION (GROUPS)
  // ==========================================
  console.log("Organizing Scene Hierarchy into Groups...");
  await native.groupBodies(consoleBodies, "Console");
  await native.groupBodies(cartridgeBodies, "Cartridge");
  await native.groupBodies(ctrl1Bodies, "Controller_1");
  await native.groupBodies(ctrl2Bodies, "Controller_2");
  await native.groupBodies(cableBodies, "Cables_And_Plugs");

  // ==========================================
  // 6. TOPOLOGY HEALTH VERIFICATION
  // ==========================================
  console.log("Verifying Parasolid Topology...");
  const allState = await native.state();
  const solidIds = allState.bodies.filter((b) => b.type === "Solid").map((b) => b.id);
  console.log(`Checking ${solidIds.length} solid bodies...`);
  const checks = await native.checkBodies(solidIds);
  const invalid = checks.filter((c) => !c.valid);
  if (invalid.length > 0) {
    console.error("FAIL: Invalid solids found:", invalid);
    throw new Error(`Topology check failed for ${invalid.length} bodies`);
  }
  console.log(`SUCCESS: All ${solidIds.length} solids are 100% Parasolid-valid!`);

  // ==========================================
  // 7. EXPORT CAD MODELS (.plasticity, .step)
  // ==========================================
  console.log("Exporting CAD models...");
  const plasticityPath = join(EXAMPLES_DIR, "nes.plasticity");
  const stepPath = join(EXAMPLES_DIR, "nes.step");

  await native.saveCopy(plasticityPath, true);
  console.log(`Saved: ${plasticityPath}`);

  await native.exportStep(stepPath, undefined, true);
  console.log(`Saved: ${stepPath}`);

  // ==========================================
  // 8. TECHNICAL DRAWINGS (SVGs)
  // ==========================================
  console.log("Exporting Technical Vector Drawings...");
  const views: Array<"front" | "back" | "left" | "right" | "top" | "bottom" | "isometric"> = [
    "front", "back", "left", "right", "top", "bottom", "isometric"
  ];
  for (const v of views) {
    const svgPath = join(DRAWINGS_DIR, `nes-${v}.svg`);
    await native.exportDrawing(svgPath, solidIds, [v], true, true);
    console.log(`Exported SVG: nes-${v}.svg`);
  }

  // Full composite sheet SVG (all 7 views)
  const sheetPath = join(DRAWINGS_DIR, "nes-sheet.svg");
  await native.exportDrawing(sheetPath, solidIds, views, true, true);
  console.log(`Exported SVG: nes-sheet.svg`);

  // ==========================================
  // 9. HIGH-RESOLUTION RENDERS & SCREENSHOTS
  // ==========================================
  console.log("Rendering High-Resolution Viewport Shots...");
  const standardViews: Array<{ name: string; view: any }> = [
    { name: "view-front", view: "front" },
    { name: "view-back", view: "back" },
    { name: "view-left", view: "left" },
    { name: "view-right", view: "right" },
    { name: "view-top", view: "top" },
    { name: "view-bottom", view: "bottom" },
    { name: "view-iso-front-left", view: [-1, -1, 0.8] },
    { name: "view-iso-front-right", view: [1, -1, 0.8] },
    { name: "view-iso-rear-left", view: [-1, 1, 0.8] },
    { name: "view-iso-rear-right", view: [1, 1, 0.8] }
  ];

  for (const { name, view } of standardViews) {
    try {
      await native.setView(view);
      await delay(300);
      const outPath = join(EXAMPLES_DIR, `${name}.png`);
      await native.screenshot(outPath, true);
      console.log(`Rendered: ${name}.png`);
    } catch (e) {
      console.warn(`Could not render ${name}:`, e);
    }
  }

  // Detail macro renders
  const detailViews = [
    { name: "detail-controls", view: [-0.6, -1, 0.4], ids: [lowerChassisId, powerBtn.id, resetBtn.id, ledJewel.id] },
    { name: "detail-cartridge", view: [0.8, -0.6, 0.5], ids: cartridgeBodies },
    { name: "detail-controller-dpad", view: [-0.3, -1, 0.9], ids: ctrl1Bodies.slice(0, 5) },
    { name: "detail-controller-buttons", view: [0.3, -1, 0.9], ids: ctrl1Bodies.slice(5) },
    { name: "detail-ports", view: [-0.4, -1, 0.3], ids: [lowerChassisId, cableBodies[0]!, cableBodies[1]!] }
  ];

  for (const { name, view, ids } of detailViews) {
    try {
      await native.setView(view as any, ids);
      await delay(300);
      const outPath = join(EXAMPLES_DIR, `${name}.png`);
      await native.screenshot(outPath, true);
      console.log(`Rendered macro detail: ${name}.png`);
    } catch (e) {
      console.warn(`Could not render ${name}:`, e);
    }
  }

  console.log("=== CAD BUILD AND EXPORT COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
