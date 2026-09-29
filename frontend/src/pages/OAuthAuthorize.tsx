import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import * as api from '../api';

const SCOPE_LABELS: Record<string, string> = {
  'drawings:read': 'See your drawings',
  'drawings:write': 'Add and replace drawings',
  'collections:read': 'See your collections',
  'collections:write': 'Create collections',
};

/**
 * Consent screen for the MCP connector's OAuth flow (e.g. Claude). Reached
 * from the connector's "Connect" button; ProtectedRoute signs the user in
 * first and brings them back here.
 */
export const OAuthAuthorize: React.FC = () => {
  const [searchParams] = useSearchParams();
  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const [details, setDetails] = useState<api.OAuthAuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getOAuthAuthorization(params)
      .then((result) => {
        if (!cancelled) setDetails(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(api.describeOAuthError(err, 'This connection request is invalid.'));
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const decide = async (decision: 'approve' | 'deny') => {
    setSubmitting(decision);
    setError(null);
    try {
      window.location.assign(await api.decideOAuthAuthorization(params, decision));
    } catch (err: unknown) {
      setError(api.describeOAuthError(err, 'Could not complete the request.'));
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Logo className="mx-auto h-12 w-auto" />
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-white">
            {details ? `Connect ${details.clientName}` : 'Connect an app'}
          </h2>
          {details && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-900 dark:text-white">{details.clientName}</span>{' '}
              ({details.redirectOrigin}) wants to access ExcaliDash as{' '}
              <span className="font-medium text-gray-900 dark:text-white">{details.user.email}</span>.
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <div className="text-sm text-red-800 dark:text-red-200">{error}</div>
          </div>
        )}

        {!details && !error && (
          <div className="text-center text-gray-600 dark:text-gray-400">Loading...</div>
        )}

        {details && (
          <div className="space-y-6">
            <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-sm font-medium text-gray-900 dark:text-white">It will be able to:</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                {details.scopes.map((scope) => (
                  <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                This creates an API key named “{details.clientName} (OAuth)”. You can revoke it at any
                time under Profile → API Keys.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={submitting !== null}
                onClick={() => decide('deny')}
                className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting !== null}
                onClick={() => decide('approve')}
                className="flex-1 py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {submitting === 'approve' ? 'Connecting...' : 'Allow'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
