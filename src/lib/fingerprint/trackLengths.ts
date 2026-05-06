/**
 * Real-world iRacing track lengths in meters, indexed by lowercased substring
 * matched against either the lapfile folder path or `header.trackName`.
 *
 * The lapfile descriptor's "track length" field is only reliable for short
 * ovals — long road courses get truncated by iRacing's bin-budget scaler.
 * We override with these published values when a folder name matches.
 *
 * Length keys are matched in order; first hit wins, so put more specific
 * variants (e.g. `nurburgring\nordschleife`) BEFORE generic ones
 * (`nurburgring`).
 */
const TRACKS: { match: RegExp; m: number; label?: string }[] = [
  // Nürburgring
  { match: /nurburgring.*nordschleife/, m: 20832, label: "Nordschleife" },
  { match: /nurburgring.*combinedshortb/, m: 25378, label: "Nordschleife + GP Sprint" },
  { match: /nurburgring.*combined/, m: 25378, label: "Nordschleife + GP" },
  { match: /nurburgring.*gp/, m: 5148, label: "GP" },
  { match: /nurburgring/, m: 5148 },
  // Spa
  { match: /spa.*2024.*combined/, m: 7004, label: "Spa 2024" },
  { match: /spa.*2024.*up/, m: 7004, label: "Spa 2024" },
  { match: /spa.*classic/, m: 14100, label: "Spa Classic" },
  { match: /spa/, m: 7004 },
  // Le Mans
  { match: /lemans.*full/, m: 13626, label: "Circuit de la Sarthe" },
  { match: /lemans.*bugatti/, m: 4185, label: "Bugatti" },
  { match: /lemans/, m: 13626 },
  // Monza
  { match: /monza.*combinedchicanes/, m: 5793, label: "GP" },
  { match: /monza.*gp/, m: 5793 },
  { match: /monza.*oval/, m: 4250, label: "Oval" },
  { match: /monza/, m: 5793 },
  // Silverstone
  { match: /silverstone.*international/, m: 2972 },
  { match: /silverstone.*national/, m: 2620 },
  { match: /silverstone.*gp/, m: 5891 },
  { match: /silverstone/, m: 5891 },
  // Common road courses
  { match: /roadamerica/, m: 6515 },
  { match: /roadatlanta.*full/, m: 4088 },
  { match: /roadatlanta/, m: 4088 },
  { match: /watkinsglen.*boot/, m: 5552 },
  { match: /watkinsglen/, m: 3401 },
  { match: /sebring.*international/, m: 6020 },
  { match: /sebring/, m: 6020 },
  { match: /suzuka.*east/, m: 2243 },
  { match: /suzuka.*west/, m: 3466 },
  { match: /suzuka/, m: 5807 },
  { match: /imola/, m: 4909 },
  { match: /barcelona.*motogp/, m: 4657 },
  { match: /barcelona/, m: 4657 },
  { match: /interlagos/, m: 4309 },
  { match: /zandvoort/, m: 4259 },
  { match: /redbullring/, m: 4318 },
  { match: /hungaroring/, m: 4381 },
  { match: /paulricard/, m: 5842 },
  { match: /mosport|cantirep|canadiantire/, m: 3957 },
  { match: /lagunaseca/, m: 3602 },
  { match: /sonoma/, m: 4054 },
  { match: /lime ?rock|limerock/, m: 2459 },
  { match: /vir/, m: 5263 },
  { match: /mid ?ohio|midohio/, m: 3636 },
  { match: /summit ?point|summitpoint/, m: 3300 },
  { match: /cota/, m: 5513 },
  { match: /sandown/, m: 3104 },
  { match: /bathurst|mountpanorama/, m: 6213 },
  { match: /phillipisland/, m: 4445 },
  { match: /donington/, m: 4023 },
  { match: /brandshatch.*indy/, m: 1929 },
  { match: /brandshatch/, m: 3908 },
  { match: /oulton/, m: 4322 },
  { match: /snetterton/, m: 4778 },
  { match: /knockhill/, m: 2092 },
  { match: /thruxton/, m: 3792 },
  { match: /croft/, m: 3417 },
  { match: /motegi/, m: 4801 },
  { match: /tsukuba/, m: 2045 },
  { match: /fuji/, m: 4563 },
  { match: /okayama/, m: 3703 },
  { match: /algarve|portimao/, m: 4684 },
  { match: /jerez/, m: 4428 },
  { match: /motorland|aragon/, m: 5345 },
  { match: /sachsenring/, m: 3671 },
  { match: /lausitzring/, m: 4255 },
  { match: /hockenheim/, m: 4574 },
  { match: /nurburg.*muller/, m: 5148 },
  { match: /jacksonville/, m: 1207 },
  { match: /charlotte.*roval/, m: 3947 },
  { match: /charlotte/, m: 2414 }, // oval
  { match: /daytona.*road/, m: 5729 },
  { match: /daytona/, m: 4023 }, // oval
  { match: /talladega/, m: 4281 },
  { match: /indianapolis.*road|indianapolis.*gp/, m: 4143 },
  { match: /indianapolis/, m: 4023 },
  { match: /atlanta.*motor/, m: 2414 },
  { match: /texas.*motor/, m: 2414 },
  { match: /las ?vegas|lasvegas/, m: 2414 },
  { match: /kansas|kansasspeedway/, m: 2414 },
  { match: /michigan.*speedway/, m: 3219 },
  { match: /pocono/, m: 4023 },
  { match: /bristol/, m: 858 },
  { match: /martinsville/, m: 845 },
  { match: /richmond/, m: 1207 },
  { match: /dover/, m: 1609 },
  { match: /phoenix.*raceway/, m: 1609 },
  { match: /new ?hampshire|newhampshire/, m: 1721 },
  { match: /homestead/, m: 2414 },
  { match: /chicago.*street/, m: 3540 },
];

/** Return the canonical track length (m) for a folder/trackName match, or null. */
export function knownTrackLength(folder: string, trackName?: string): { m: number; label?: string } | null {
  const key = `${folder} ${trackName ?? ""}`.toLowerCase().replace(/\\/g, "/");
  for (const t of TRACKS) {
    if (t.match.test(key)) return { m: t.m, label: t.label };
  }
  return null;
}