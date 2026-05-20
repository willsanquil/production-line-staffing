import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DayLogDetail, DayLogSummary, LineConfig } from '../../types';
import { getDayLog, listDayLogs } from '../../lib/cloudLines';
import {
  aggregatePersonStationMatrix,
  aggregateStationTotals,
  comparePeopleAtStation,
  defaultDateRangeDays,
  uniquePeopleFromLogs,
  uniqueStationsFromLogs,
} from '../../lib/dayLogReports';
import { DayLogPlacement } from './DayLogPlacement';

interface HistoryReportsViewProps {
  lineId: string;
  password: string;
  lineConfig: LineConfig;
  onBack: () => void;
}

type Tab = 'day' | 'reports';

export function HistoryReportsView({ lineId, password, lineConfig, onBack }: HistoryReportsViewProps) {
  const [tab, setTab] = useState<Tab>('day');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<DayLogSummary[]>([]);
  const [selectedWorkDate, setSelectedWorkDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayLogDetail | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const [fromDate, setFromDate] = useState(() => defaultDateRangeDays(30).fromDate);
  const [toDate, setToDate] = useState(() => defaultDateRangeDays(30).toDate);
  const [reportLogs, setReportLogs] = useState<DayLogDetail[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [personA, setPersonA] = useState('');
  const [personB, setPersonB] = useState('');
  const [compareAreaId, setCompareAreaId] = useState('');

  const loadSummaries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const logs = await listDayLogs(lineId, password);
      setSummaries(logs);
      if (logs.length > 0 && !selectedWorkDate) {
        setSelectedWorkDate(logs[0].workDate);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [lineId, password]);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  useEffect(() => {
    if (!selectedWorkDate) {
      setDayDetail(null);
      return;
    }
    let cancelled = false;
    setDayLoading(true);
    getDayLog(lineId, password, { workDate: selectedWorkDate })
      .then((d) => {
        if (!cancelled) setDayDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lineId, password, selectedWorkDate]);

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    setError(null);
    try {
      const list = await listDayLogs(lineId, password, fromDate, toDate);
      const details = await Promise.all(
        list.map((s) => getDayLog(lineId, password, { logId: s.id }))
      );
      setReportLogs(details);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReportsLoading(false);
    }
  }, [lineId, password, fromDate, toDate]);

  useEffect(() => {
    if (tab === 'reports') void loadReports();
  }, [tab, loadReports]);

  const matrix = useMemo(() => aggregatePersonStationMatrix(reportLogs), [reportLogs]);
  const stationTotals = useMemo(() => aggregateStationTotals(reportLogs), [reportLogs]);
  const people = useMemo(() => uniquePeopleFromLogs(reportLogs), [reportLogs]);
  const stations = useMemo(() => uniqueStationsFromLogs(reportLogs), [reportLogs]);
  const compare = useMemo(() => {
    if (!personA || !personB) return [];
    return comparePeopleAtStation(reportLogs, personA, personB, compareAreaId || undefined);
  }, [reportLogs, personA, personB, compareAreaId]);

  const snapshotConfig = dayDetail?.snapshot?.lineConfig as LineConfig | undefined;
  const placementConfig = snapshotConfig ?? lineConfig;
  const areaNameOverrides = (dayDetail?.snapshot?.areaNameOverrides ?? {}) as Record<string, string>;

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack}>
          Back to staffing
        </button>
        <h2 style={{ margin: 0 }}>History &amp; reports — {lineConfig.name}</h2>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={tab === 'day' ? 'btn-primary' : undefined}
          onClick={() => setTab('day')}
        >
          Day view
        </button>
        <button
          type="button"
          className={tab === 'reports' ? 'btn-primary' : undefined}
          onClick={() => setTab('reports')}
        >
          Reports (30 days)
        </button>
      </div>

      {error && (
        <div style={{ background: '#fde8e8', padding: 10, borderRadius: 6, marginBottom: 12, color: '#a00' }}>
          {error}
        </div>
      )}

      {tab === 'day' && (
        <div>
          {loading ? (
            <p>Loading logged days…</p>
          ) : summaries.length === 0 ? (
            <p>No logged days yet. Use &quot;Log the day&quot; on the staffing screen to save a snapshot.</p>
          ) : (
            <>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ fontWeight: 600, marginRight: 8 }}>Logged date</span>
                <select
                  value={selectedWorkDate ?? ''}
                  onChange={(e) => setSelectedWorkDate(e.target.value)}
                >
                  {summaries.map((s) => (
                    <option key={s.id} value={s.workDate}>
                      {s.workDate} ({s.assignmentCount} assignments)
                    </option>
                  ))}
                </select>
              </label>
              {dayLoading && <p>Loading day…</p>}
              {dayDetail && !dayLoading && (
                <>
                  <p style={{ color: '#666', fontSize: '0.9rem' }}>
                    Logged {new Date(dayDetail.loggedAt).toLocaleString()} · {dayDetail.shiftHours}h shift
                    {dayDetail.notes ? ` · ${dayDetail.notes}` : ''}
                  </p>
                  <DayLogPlacement
                    lineConfig={placementConfig}
                    assignments={dayDetail.assignments}
                    areaNameOverrides={areaNameOverrides}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
            <label>
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ display: 'block' }} />
            </label>
            <label>
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ display: 'block' }} />
            </label>
            <button type="button" className="btn-primary" onClick={() => void loadReports()} disabled={reportsLoading}>
              {reportsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {reportsLoading ? (
            <p>Loading report data…</p>
          ) : reportLogs.length === 0 ? (
            <p>No logs in this date range.</p>
          ) : (
            <>
              <section className="section-card" style={{ padding: 16, marginBottom: 16 }}>
                <h3 style={{ marginTop: 0 }}>Compare two people</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                  <label>
                    Person A
                    <select value={personA} onChange={(e) => setPersonA(e.target.value)} style={{ display: 'block', minWidth: 140 }}>
                      <option value="">Select…</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Person B
                    <select value={personB} onChange={(e) => setPersonB(e.target.value)} style={{ display: 'block', minWidth: 140 }}>
                      <option value="">Select…</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Station (optional)
                    <select
                      value={compareAreaId}
                      onChange={(e) => setCompareAreaId(e.target.value)}
                      style={{ display: 'block', minWidth: 140 }}
                    >
                      <option value="">All stations</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {personA && personB && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                        <th>Station</th>
                        <th>Person A (days)</th>
                        <th>Person A (est. hrs)</th>
                        <th>Person B (days)</th>
                        <th>Person B (est. hrs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.map((row) => (
                        <tr key={row.areaId} style={{ borderBottom: '1px solid #eee' }}>
                          <td>{row.areaName}</td>
                          <td>{row.personA.days}</td>
                          <td>{row.personA.estimatedHours}</td>
                          <td>{row.personB.days}</td>
                          <td>{row.personB.estimatedHours}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="section-card" style={{ padding: 16, marginBottom: 16 }}>
                <h3 style={{ marginTop: 0 }}>Person × station (primary assignments)</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                        <th>Person</th>
                        <th>Station</th>
                        <th>Days</th>
                        <th>Est. hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.map((row) => (
                        <tr key={`${row.personId}-${row.areaId}`} style={{ borderBottom: '1px solid #eee' }}>
                          <td>{row.personName}</td>
                          <td>{row.areaName}</td>
                          <td>{row.days}</td>
                          <td>{row.estimatedHours}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="section-card" style={{ padding: 16 }}>
                <h3 style={{ marginTop: 0 }}>Station totals</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                      <th>Station</th>
                      <th>Assignment-days</th>
                      <th>Est. hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stationTotals.map((row) => (
                      <tr key={row.areaId} style={{ borderBottom: '1px solid #eee' }}>
                        <td>{row.areaName}</td>
                        <td>{row.assignmentDays}</td>
                        <td>{row.estimatedHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
