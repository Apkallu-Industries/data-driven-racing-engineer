/** Map an iRacing carShortName to a broad racing class. */
export type CarClass =
  | "GT3"
  | "GTP"
  | "LMP"
  | "GTE"
  | "GT4"
  | "TCR"
  | "NASCAR Cup"
  | "NASCAR Xfinity"
  | "NASCAR Truck"
  | "Dirt Oval"
  | "IndyCar"
  | "Formula"
  | "Prototype"
  | "Road"
  | "Other";

const RULES: { match: RegExp; cls: CarClass }[] = [
  { match: /gt3|amggt3|m4gt3|porsche992r|audir8lms|ferrari296gt3|lamborghini.*gt3|mclaren720|bmw.*gt3|mercedes.*gt3/, cls: "GT3" },
  { match: /gtp|lmdh|acuraarx|cadillacvr|porsche963|ferrari499|bmwlmdh/, cls: "GTP" },
  { match: /lmp1|lmp2|lmp3|dallarap217|audir18|porsche919|hpdarx|rileymk/, cls: "LMP" },
  { match: /gte|c8rvettegte|porsche911rsr|ferrari488gte|bmwm8gte|fordgt/, cls: "GTE" },
  { match: /gt4|porschecaymangt4|bmwm4gt4|mclaren570/, cls: "GT4" },
  { match: /tcr|audirs3lms|hyundaivelostertcr|hondacivictcr/, cls: "TCR" },
  { match: /nextgen|cup.*chevy|cup.*ford|cup.*toyota|stockcars2023/, cls: "NASCAR Cup" },
  { match: /xfinity|nascarcamry|mustang_xfinity/, cls: "NASCAR Xfinity" },
  { match: /truck|silverado|tundra|f150/, cls: "NASCAR Truck" },
  { match: /dirt|sprint|midget|legends|streetstock|modified/, cls: "Dirt Oval" },
  { match: /indycar|dallaraindy|dallarair/, cls: "IndyCar" },
  { match: /formula|f1|f3|f4|fr2\.0|skipbarber|mx5|formularenault|tatuus|fia.*f4|williams.*fw|mercedes.*amg.*f1/, cls: "Formula" },
  { match: /radical|prototype|csl|dallara/, cls: "Prototype" },
];

export function classifyCar(carShortName: string): CarClass {
  const s = carShortName.toLowerCase().replace(/[\s_-]/g, "");
  for (const r of RULES) if (r.match.test(s)) return r.cls;
  return "Other";
}