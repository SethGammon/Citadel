import { useState, useEffect, useCallback } from 'react';
import type {
  Campaign,
  CampaignDetail,
  CampaignSpan,
  FleetSession,
  FleetAnalyticsData,
  AggregateAnalyticsData,
  HealthStatus,
  Skill,
  TelemetryEvent,
} from '../../shared/types.js';

export type {
  Campaign,
  CampaignDetail,
  CampaignSpan,
  FleetSession,
  FleetAnalyticsData,
  AggregateAnalyticsData,
  HealthStatus,
  Skill,
  TelemetryEvent,
};

const HEALTH_POLL_MS = 30_000;

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string;
}

function useAsyncFetch<T>(
  fetcher: () => Promise<T>,
  pollMs?: number
): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: '',
  });

  const fetch = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    void fetcher()
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((err: unknown) =>
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
  }, [fetcher]);

  useEffect(() => {
    fetch();

    if (!pollMs) return;

    const interval = setInterval(() => {
      if (!document.hidden) fetch();
    }, pollMs);

    const handleVisibility = () => {
      if (!document.hidden) fetch();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetch, pollMs]);

  return { ...state, refetch: fetch };
}

// ---------------------------------------------------------------------------
// Free tier hooks
// ---------------------------------------------------------------------------

export function useCampaigns() {
  const fetcher = useCallback(async (): Promise<Campaign[]> => {
    const result = await window.citadel.getCampaigns();
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return result as Campaign[];
  }, []);

  const { data, loading, error, refetch } = useAsyncFetch(fetcher);
  return { campaigns: data ?? [], loading, error, refetch };
}

export function useCampaignDetail(slug: string | null) {
  const fetcher = useCallback(async (): Promise<CampaignDetail | null> => {
    if (!slug) return null;
    const result = await window.citadel.getCampaignDetail(slug);
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return result as CampaignDetail | null;
  }, [slug]);

  const { data, loading, error, refetch } = useAsyncFetch(fetcher);
  return { detail: data, loading, error, refetch };
}

export function useFleetSessions() {
  const fetcher = useCallback(async (): Promise<FleetSession[]> => {
    const result = await window.citadel.getFleetSessions();
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return result as FleetSession[];
  }, []);

  const { data, loading, error, refetch } = useAsyncFetch(fetcher);
  return { sessions: data ?? [], loading, error, refetch };
}

export function useHealth() {
  const fetcher = useCallback(async (): Promise<HealthStatus> => {
    const result = await window.citadel.getHealth();
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return result as HealthStatus;
  }, []);

  const { data, loading, error, refetch } = useAsyncFetch(fetcher, HEALTH_POLL_MS);
  return { health: data, loading, error, refetch };
}

export function useSkills() {
  const fetcher = useCallback(async (): Promise<Skill[]> => {
    const result = await window.citadel.getSkills();
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return result as Skill[];
  }, []);

  const { data, loading, error, refetch } = useAsyncFetch(fetcher);
  return { skills: data ?? [], loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Pro tier hooks — return isPro=false sentinel when PRO_REQUIRED
// ---------------------------------------------------------------------------

type ProState<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  proRequired: boolean;
  refetch: () => void;
};

function useProFetch<T>(fetcher: () => Promise<unknown>): ProState<T> {
  const [state, setState] = useState<Omit<ProState<T>, 'refetch'>>({
    data: null,
    loading: true,
    error: '',
    proRequired: false,
  });

  const fetch = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: '', proRequired: false }));
    void fetcher()
      .then((raw) => {
        if (
          raw &&
          typeof raw === 'object' &&
          'error' in raw &&
          (raw as { error: string }).error === 'PRO_REQUIRED'
        ) {
          setState({ data: null, loading: false, error: '', proRequired: true });
          return;
        }
        setState({ data: raw as T, loading: false, error: '', proRequired: false });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'PRO_REQUIRED') {
          setState({ data: null, loading: false, error: '', proRequired: true });
        } else {
          setState({ data: null, loading: false, error: msg, proRequired: false });
        }
      });
  }, [fetcher]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { ...state, refetch: fetch };
}

export function useCampaignTimeline() {
  const fetcher = useCallback(() => window.citadel.getCampaignTimeline(), []);
  const state = useProFetch<CampaignSpan[]>(fetcher);
  return { ...state, timeline: state.data ?? [] };
}

export function useTokenEconomics() {
  const fetcher = useCallback(() => window.citadel.getTokenEconomics(), []);
  const state = useProFetch<HealthStatus>(fetcher);
  return { ...state, health: state.data };
}

export function useFleetAnalytics() {
  const fetcher = useCallback(() => window.citadel.getFleetAnalytics(), []);
  const state = useProFetch<FleetAnalyticsData>(fetcher);
  return { ...state, analytics: state.data };
}

export function useTelemetryEvents(campaignSlug: string | null) {
  const fetcher = useCallback(
    () => window.citadel.getTelemetryEvents(campaignSlug ?? undefined),
    [campaignSlug]
  );
  const state = useProFetch<TelemetryEvent[]>(fetcher);
  return { ...state, events: state.data ?? [] };
}

export function useAggregateAnalytics() {
  const fetcher = useCallback(() => window.citadel.getAggregateAnalytics(), []);
  const state = useProFetch<AggregateAnalyticsData>(fetcher);
  return { ...state, analytics: state.data };
}
