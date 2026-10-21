export const ACTION_SETUP_VERSION = 'TRUSTPR-ACTION-SETUP-V1';
export const TRUSTPR_ACTION_REPOSITORY = 'SamCT86/trustpr-action';
export const ACTION_SETUP_PERMISSIONS = Object.freeze({
  actions: 'read',
  checks: 'read',
  contents: 'read',
  'pull-requests': 'read'
});

const ACTION_REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const ACTION_COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertClosedObject(value, allowedKeys, code) {
  if (!isPlainObject(value)) fail(code);
  const keys = Object.keys(value);
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) {
    fail(code);
  }
}

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function validateActionIdentity(input, allowedKeys, inputCode) {
  assertClosedObject(input, allowedKeys, inputCode);
  const { actionRepository, actionCommitSha } = input;
  if (typeof actionRepository !== 'string'
      || !ACTION_REPOSITORY_RE.test(actionRepository)
      || actionRepository.includes('..')
      || actionRepository.endsWith('.git')
      || actionRepository.includes('@')
      || actionRepository.toLowerCase() !== TRUSTPR_ACTION_REPOSITORY.toLowerCase()) {
    fail('ACTION_REPOSITORY_INVALID');
  }
  if (typeof actionCommitSha !== 'string' || !ACTION_COMMIT_SHA_RE.test(actionCommitSha)) {
    fail('ACTION_COMMIT_SHA_INVALID');
  }
  return { actionRepository: TRUSTPR_ACTION_REPOSITORY, actionCommitSha };
}

export function buildTrustPrActionWorkflow(input) {
  const { actionRepository, actionCommitSha } = validateActionIdentity(
    input,
    ['actionRepository', 'actionCommitSha'],
    'ACTION_SETUP_INPUT_INVALID'
  );
  return {
    name: 'TrustPR evidence receipt',
    on: {
      pull_request: {
        types: ['opened', 'synchronize', 'reopened', 'ready_for_review']
      }
    },
    permissions: { ...ACTION_SETUP_PERMISSIONS },
    jobs: {
      trustpr: {
        name: 'TrustPR evidence receipt',
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 10,
        steps: [{
          name: 'Generate TrustPR evidence receipt',
          uses: actionRepository + '@' + actionCommitSha,
          with: {
            repository: '${{ github.repository }}',
            'pull-request-number': '${{ github.event.pull_request.number }}',
            'base-sha': '${{ github.event.pull_request.base.sha }}',
            'head-sha': '${{ github.event.pull_request.head.sha }}'
          }
        }]
      }
    }
  };
}

export function renderTrustPrActionWorkflowYaml(input) {
  const model = buildTrustPrActionWorkflow(input);
  const step = model.jobs.trustpr.steps[0];
  return [
    'name: TrustPR evidence receipt',
    '',
    'on:',
    '  pull_request:',
    '    types:',
    '      - opened',
    '      - synchronize',
    '      - reopened',
    '      - ready_for_review',
    '',
    'permissions:',
    '  actions: read',
    '  checks: read',
    '  contents: read',
    '  pull-requests: read',
    '',
    'jobs:',
    '  trustpr:',
    '    name: TrustPR evidence receipt',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 10',
    '    steps:',
    '      - name: Generate TrustPR evidence receipt',
    '        uses: ' + step.uses,
    '        with:',
    '          repository: ${{ github.repository }}',
    '          pull-request-number: ${{ github.event.pull_request.number }}',
    '          base-sha: ${{ github.event.pull_request.base.sha }}',
    '          head-sha: ${{ github.event.pull_request.head.sha }}',
    ''
  ].join('\n');
}
