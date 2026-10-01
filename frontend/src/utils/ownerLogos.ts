/**
 * utils/ownerLogos.ts — owner name → logo asset, for the little brand chip
 * shown next to a node's owner.
 *
 * This map was duplicated verbatim in NodeInfoPanel and NodeFinder; it now
 * lives here so a new owner is added once. Lookup is by the exact `owner`
 * string on the node, so entries exist for the variants the dataset actually
 * uses ("Telstra" and "Telstra International" both point at the same file).
 * A miss is normal and simply means no chip is drawn.
 */
export const OWNER_LOGOS: Record<string, string> = {
  // Original full-art logos
  'Telstra':                      '/logos/telstra.svg',
  'Telstra International':        '/logos/telstra.svg',
  'Equinix':                      '/logos/equinix.svg',
  'PCCW':                         '/logos/pccw.svg',
  'DRT':                          '/logos/digitalrealty.svg',
  'Digital Realty':               '/logos/digitalrealty.svg',
  'NTT':                          '/logos/ntt.svg',
  'NEXTDC':                       '/logos/nextdc.svg',
  // Wordmark logos
  'Singtel':                      '/logos/singtel.svg',
  'Lumen':                        '/logos/lumen.svg',
  'Tata Communications':          '/logos/tatacoms.svg',
  'PLDT':                         '/logos/pldt.svg',
  'Globe Telecom':                '/logos/globetelecom.svg',
  'StarHub':                      '/logos/starhub.svg',
  'Spark NZ':                     '/logos/sparknz.svg',
  'Telkom Indonesia':             '/logos/telkomindonesia.svg',
  'Telekom Malaysia':             '/logos/telekommalaysia.svg',
  'BT':                           '/logos/bt.svg',
  'Microsoft':                    '/logos/microsoft.svg',
  'KINX':                         '/logos/kinx.svg',
  'Converge ICT':                 '/logos/converge.svg',
  'Epsilon':                      '/logos/epsilon.svg',
  'eASPNet':                      '/logos/easpnet.svg',
  'e&':                           '/logos/eand.svg',
  'Reach':                        '/logos/reach.svg',
  'Southern Cross Cable Network': '/logos/southerncross.svg',
  'Hawaiian Telcom':              '/logos/hawaiiantelcom.svg',
  'Singapore Stock Exchange':     '/logos/sgx.svg',
  'Hong Kong Exchange':           '/logos/hkex.svg',
  'GTA':                          '/logos/gta.svg',
  'IT&E Overseas':                '/logos/ite.svg',
  'Djibouti Telecom':             '/logos/djiboutitelecom.svg',
  'Dynamic Computing Technology': '/logos/dct.svg',
  'BDX':                          '/logos/bdx.svg',
  'Seren Juno':                   '/logos/serenjuno.svg',
  'TIS':                          '/logos/tis.svg',
  'TBC':                          '/logos/tbc.svg',
  'Apricot Consortium':           '/logos/apricot.svg',
  'JGA Consortium':               '/logos/jga.svg',
  'Jupiter Consortium':           '/logos/jupiter.svg',
}

