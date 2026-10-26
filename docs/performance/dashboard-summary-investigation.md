# Dashboard summary latency investigation

Added development-only `Server-Timing` spans around authentication/setup, module loading, each of the five parallel Supabase requests, aggregation, and middleware total. The local dashboard diagnostic panel collects only allowlisted span names and durations. No account identifiers, tokens, query parameters, response content, or error messages are recorded.

Ten signed-in desktop document reloads after one discarded warmup took **111.8–313.3 ms** per summary request (median **184.25 ms**). Authentication/setup took **2–6.1 ms**, aggregation **0.1–0.2 ms**. The slowest parallel data request took **92–293.8 ms**, accounting for most measured server time. Different data calls finished last; these observations do not identify one consistently slow table.

The earlier **28.6-second** response did not recur. Its historical cause remains unknown: these new spans cannot retrospectively explain an uninstrumented request. Database spans include HTTP transport, Supabase gateway/queuing, database execution, and response parsing; they are not SQL execution times. No index, authentication, or query behavior changes are justified by this small sample alone.

`auth_setup` includes middleware client creation, token verification, validation, and dispatch before the handler. `module_load` is timed separately. `total` starts at the timing middleware and ends after the handler returns; framework work before middleware and subsequent serialization/transport fall outside it. Parallel spans overlap and must not be added together.

Next, capture a recurring slow response with these spans. If authentication dominates, investigate verification/key-fetch latency. If a data span dominates, correlate it with Supabase request/database logs before proposing query or index changes. If server total is low but browser duration is high, investigate transport or framework work outside the measured interval. No automatic polling or background account requests were added.

Raw numeric samples: [dashboard-summary-investigation.json](dashboard-summary-investigation.json). This is a development diagnosis, not a controlled production performance comparison. Authentication and row-level access controls remain unchanged. Nothing was deployed or pushed in this investigation.
