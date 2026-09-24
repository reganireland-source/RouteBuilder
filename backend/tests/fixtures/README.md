# Test fixtures

`ajc_scm_paths.json` — a one-time capture of submarinecablemap.com's real
"Australia-Japan Cable (AJC)" geometry (cable id `australia-japan-cable-ajc`),
in the same `[{"name", "coords"}]` shape `app.kml.parser.parse_kml` produces.
Captured during development of `app/kml/flatten.py` because this specific
cable's real data is what found two real bugs in the flattening algorithm
(see `test_kml_flatten.py`'s module docstring) — it is small (5 fragments),
genuinely branches at Guam, and its consecutive-point spacing swings from a
few km to ~900 km within one trusted fragment, which is exactly the case that
broke a naive point-level approach. Frozen to disk rather than fetched live so
`test_kml_flatten.py`'s regression tests don't depend on network access or on
submarinecablemap.com's data staying byte-identical over time.
