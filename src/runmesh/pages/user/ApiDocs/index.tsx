import React from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';
import { useNavigate } from 'react-router-dom';

const CodeBlock: React.FC<{ children: string; className?: string }> = ({ children, className }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard
      .writeText(children.trim())
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };
  return (
    <div className={`relative group ${className || ''}`}>
      <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-sm font-mono overflow-x-auto whitespace-pre">
        {children.trim()}
      </pre>
      <button
        onClick={handleCopy}
        className={`absolute top-2 right-2 p-1.5 rounded-md text-slate-300 transition-all ${
          copied
            ? 'bg-green-600 opacity-100'
            : 'bg-slate-700 opacity-0 group-hover:opacity-100 hover:bg-slate-600'
        }`}
        title={copied ? 'Copied!' : 'Copy'}
      >
        {copied ? <Icons.Check className="w-4 h-4" /> : <Icons.Copy className="w-4 h-4" />}
      </button>
    </div>
  );
};

export const ApiDocs: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <button
          onClick={() => navigate('/app/profile')}
          className="text-sm text-brand-600 hover:text-brand-700 flex items-center space-x-1 mb-4"
        >
          <Icons.ChevronLeft className="w-4 h-4" />
          <span>{t('apiDocs.backToProfile')}</span>
        </button>
        <h1 className="text-2xl font-bold text-slate-800">{t('apiDocs.title')}</h1>
        <p className="text-slate-500 mt-1">{t('apiDocs.subtitle')}</p>
      </div>

      <div className="space-y-8">
        {/* Step 1: Generate Token */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-2">
              <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold">
                1
              </span>
              <span>{t('apiDocs.step1.title')}</span>
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">{t('apiDocs.step1.description')}</p>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => navigate('/app/profile')}
                className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors"
              >
                {t('apiDocs.step1.goToProfile')}
              </button>
            </div>
            <p className="text-xs text-slate-400">{t('apiDocs.step1.hint')}</p>
          </div>
        </section>

        {/* Step 2: CLI Usage */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-2">
              <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold">
                2
              </span>
              <span>{t('apiDocs.step2.title')}</span>
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">{t('apiDocs.step2.description')}</p>

            <h3 className="text-sm font-semibold text-slate-700 mt-4">
              {t('apiDocs.step2.envVar')}
            </h3>
            <CodeBlock>{`export RUNMESH_API_TOKEN="rmk_your_token_here"
export RUNMESH_BASE_URL="https://your-server.com"

# Now all CLI commands use your API token
runmesh workflows list
runmesh tasks list`}</CodeBlock>

            <h3 className="text-sm font-semibold text-slate-700 mt-4">
              {t('apiDocs.step2.inline')}
            </h3>
            <CodeBlock>{`RUNMESH_API_TOKEN="rmk_your_token_here" runmesh workflows list`}</CodeBlock>

            <h3 className="text-sm font-semibold text-slate-700 mt-4">
              {t('apiDocs.step2.tokenCmd')}
            </h3>
            <CodeBlock>{`# Login first (session-based)
runmesh login admin admin123

# Generate a new API token
runmesh token generate "My CI Token"

# List your tokens
runmesh token list

# Revoke a token
runmesh token revoke <tokenId>`}</CodeBlock>
          </div>
        </section>

        {/* Step 3: API Usage */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-2">
              <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold">
                3
              </span>
              <span>{t('apiDocs.step3.title')}</span>
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">{t('apiDocs.step3.description')}</p>

            <h3 className="text-sm font-semibold text-slate-700">
              {t('apiDocs.step3.listWorkflows')}
            </h3>
            <CodeBlock>{`curl -s -H "Authorization: Bearer rmk_your_token_here" \\
  -H "Content-Type: application/json" \\
  https://your-server.com/runmesh/workflows/list`}</CodeBlock>

            <h3 className="text-sm font-semibold text-slate-700 mt-4">
              {t('apiDocs.step3.runWorkflow')}
            </h3>
            <CodeBlock>{`curl -s -X PUT \\
  -H "Authorization: Bearer rmk_your_token_here" \\
  -H "Content-Type: application/json" \\
  -d '{"workflowId": "42", "inputData": {}}' \\
  https://your-server.com/runmesh/workflows/run`}</CodeBlock>

            <h3 className="text-sm font-semibold text-slate-700 mt-4">
              {t('apiDocs.step3.checkTask')}
            </h3>
            <CodeBlock>{`curl -s -H "Authorization: Bearer rmk_your_token_here" \\
  https://your-server.com/runmesh/task/{taskId}`}</CodeBlock>

            <h3 className="text-sm font-semibold text-slate-700 mt-4">
              {t('apiDocs.step3.pythonExample')}
            </h3>
            <CodeBlock>{`import requests

API_TOKEN = "rmk_your_token_here"
BASE_URL = "https://your-server.com"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}

# List workflows
workflows = requests.get(f"{BASE_URL}/runmesh/workflows/list", headers=HEADERS).json()
print(f"Found {len(workflows.get('rows', []))} workflows")

# Run a workflow
run_resp = requests.put(
    f"{BASE_URL}/runmesh/workflows/run",
    headers=HEADERS,
    json={"workflowId": "42", "inputData": {}},
).json()
print(f"Task started: {run_resp}")`}</CodeBlock>
          </div>
        </section>

        {/* Step 4: Accounting */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-2">
              <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold">
                4
              </span>
              <span>{t('apiDocs.step4.title')}</span>
            </h2>
          </div>
          <div className="p-6 space-y-3">
            <p className="text-sm text-slate-600">{t('apiDocs.step4.description')}</p>
            <ul className="text-sm text-slate-600 list-disc list-inside space-y-1">
              <li>{t('apiDocs.step4.point1')}</li>
              <li>{t('apiDocs.step4.point2')}</li>
              <li>{t('apiDocs.step4.point3')}</li>
              <li>{t('apiDocs.step4.point4')}</li>
            </ul>
          </div>
        </section>

        {/* Security Tips */}
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h3 className="text-sm font-bold text-amber-800 flex items-center space-x-2 mb-3">
            <Icons.Shield className="w-4 h-4" />
            <span>{t('apiDocs.security.title')}</span>
          </h3>
          <ul className="text-sm text-amber-700 list-disc list-inside space-y-1">
            <li>{t('apiDocs.security.tip1')}</li>
            <li>{t('apiDocs.security.tip2')}</li>
            <li>{t('apiDocs.security.tip3')}</li>
            <li>{t('apiDocs.security.tip4')}</li>
          </ul>
        </section>
      </div>
    </div>
  );
};
