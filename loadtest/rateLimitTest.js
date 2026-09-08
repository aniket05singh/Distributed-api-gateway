import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const allowed200 = new Counter('status_200_allowed');
const limited429 = new Counter('status_429_rate_limited');
const circuit503 = new Counter('status_503_circuit_open');

export const options = {
  scenarios: {
    // Scenario 1: Normal client within limit
    well_behaved_client: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      env: { API_KEY: 'tier-standard' },
    },
    // Scenario 2: Aggressive client hammering the gateway
    bad_actor_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },
        { duration: '20s', target: 50 },
        { duration: '5s', target: 0 },
      ],
      env: { API_KEY: 'bad-actor-client' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<100'],
  },
};

export default function () {
  const url = 'http://host.docker.internal:8080/data';
  const params = {
    headers: {
      'x-api-key': __ENV.API_KEY,
    },
  };

  const res = http.get(url, params);

  if (res.status === 200) {
    allowed200.add(1);
  } else if (res.status === 429) {
    limited429.add(1);
  } else if (res.status === 503 || res.status === 502) {
    circuit503.add(1);
  }

  check(res, {
    'status is 200, 429, or 503': (r) => [200, 429, 503].includes(r.status),
  });

  sleep(0.1);
}