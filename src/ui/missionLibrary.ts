/**
 * Mission library browser.
 *
 * It lists the local authoring library only. Deleting a document here cannot
 * touch a battle save, campaign progress or the Scenario Forge draft.
 *
 * Damaged data is never hidden: records the library could not read are listed
 * under Recovery with their original text, an export action and an explicit
 * "recover as copy" path that can never replace a valid document.
 */
import type { App } from '../app';
import type { Editor } from './editor';
import { openModal, closeModal, escapeHtml } from './modal';
import {
  canRestoreLastValid,
  deleteLibraryEntry,
  describeRecovery,
  duplicateLibraryEntry,
  ensureMissionForScenario,
  formatByteSize,
  inspectEntry,
  libraryFilename,
  libraryHealth,
  nextMissionIdForScenario,
  readLibraryRecoveries,
  readMissionLibrary,
  recoverLibraryRecord,
  recoveryFilename,
  saveScenarioToLibrary,
  searchLibrary,
  sortLibrary,
  type LibrarySort,
  type LibraryStorage,
  type MissionLibraryEntry,
} from '../mission';
import { parseScenario } from '../sim/scenario';
import { downloadJson } from './jsonFile';
import { CAMPAIGNS } from '../data/campaign';

export function openMissionLibrary(
  app: App,
  editor: Editor,
  storage: LibraryStorage = localStorage,
): void {
  let sort: LibrarySort = 'recent';
  let query = '';

  const read = (): {
    entries: MissionLibraryEntry[];
    health: ReturnType<typeof libraryHealth>;
    recoveryError: string | null;
  } => ({
    entries: readMissionLibrary(storage, { capture: false }).doc.entries,
    health: libraryHealth(storage, { probe: true }),
    recoveryError: readLibraryRecoveries(storage).error,
  });

  const renderList = (root: HTMLElement): void => {
    const { entries, health, recoveryError } = read();
    const visible = sortLibrary(searchLibrary(entries, query), sort);
    const host = root.querySelector<HTMLElement>('#mission-library-list');
    const status = root.querySelector<HTMLElement>('#mission-library-status');
    const recoveryHost = root.querySelector<HTMLElement>('#mission-library-recovery');
    if (!host) return;

    if (status) {
      status.innerHTML = `
        <span class="${health.status === 'ok' ? 'ok' : 'bad'}">${escapeHtml(health.label)}</span>
        <span>${entries.length} DOCUMENT${entries.length === 1 ? '' : 'S'}</span>
        <span>${visible.length} SHOWN</span>
        <span>${formatByteSize(health.bytes)} HELD</span>
        ${health.unreadable ? `<span class="bad">${health.unreadable} UNREADABLE</span>` : ''}
        ${health.recoveries.length ? `<span class="bad">${health.recoveries.length} PRESERVED</span>` : ''}`;
    }

    host.innerHTML = `
      ${
        health.status === 'ok'
          ? ''
          : `<div class="library-health ${health.status === 'damaged' ? 'warn' : 'bad'}">
              <b>${escapeHtml(health.label)}</b>
              <p>${escapeHtml(health.detail)}</p>
              ${health.canWrite ? '' : '<p>Nothing new can be written until this is resolved. Every open document can still be exported from the workbench.</p>'}
            </div>`
      }
      ${
        visible.length === 0
          ? `<div class="library-empty"><h3>No stored missions</h3><p>Create a draft from the scenario currently open in the Forge, or import a mission or scenario JSON from the workbench.</p></div>`
          : visible
              .map((entry) => {
                const report = inspectEntry(entry);
                const errors = report.issues.filter((issue) => issue.severity === 'error').length;
                const warnings = report.issues.filter((issue) => issue.severity === 'warning').length;
                const protectedCopy =
                  entry.campaignId !== null ||
                  Boolean(report.mission && CAMPAIGNS.some((campaign) =>
                    campaign.missions.some((mission) => mission.mission.id === report.mission!.id),
                  ));
                return `<article class="library-row" data-entry="${escapeHtml(entry.id)}">
                  <div class="library-row-main">
                    <div class="library-row-title"><b>${escapeHtml(entry.title)}</b><span class="wb-chip">${escapeHtml(entry.missionId)}</span>${entry.campaignId ? `<span class="wb-chip bad">${escapeHtml(entry.campaignId)}</span>` : '<span class="wb-chip">STANDALONE</span>'}${protectedCopy ? '<span class="wb-chip warn">CAMPAIGN COPY</span>' : ''}</div>
                    <div class="library-row-meta">
                      <span>FORMAT v${entry.formatVersion}</span>
                      <span>${report.error ? 'UNREADABLE' : errors ? `${errors} ERR` : 'VALID'}</span>
                      <span>${warnings} WARN</span>
                      <span>SAVED ${escapeHtml(new Date(entry.updatedAt).toLocaleString())}</span>
                      ${canRestoreLastValid(entry) ? `<span>LAST VALID ${escapeHtml(new Date(entry.lastValidAt ?? entry.updatedAt).toLocaleString())}</span>` : ''}
                    </div>
                    ${report.error ? `<p class="library-error">${escapeHtml(report.error)}</p>` : ''}
                  </div>
                  <div class="library-row-actions">
                    <button class="btn btn-primary" data-lib="open" ${report.error ? 'disabled' : ''}>OPEN</button>
                    <button class="btn btn-ghost" data-lib="duplicate" ${report.error ? 'disabled' : ''}>DUPLICATE</button>
                    <button class="btn btn-ghost" data-lib="export">EXPORT</button>
                    <button class="btn btn-ghost" data-lib="delete">DELETE</button>
                  </div>
                </article>`;
              })
              .join('')
      }`;

    if (recoveryHost) {
      const records = health.recoveries;
      recoveryHost.innerHTML = `
        <h3>Recovery</h3>
        ${
          records.length === 0
            ? `<p class="wb-note">Nothing is quarantined. ${recoveryError ? `The recovery store reports: ${escapeHtml(recoveryError)}` : 'Unreadable records would appear here with their original text.'}</p>`
            : `<p class="wb-note">These payloads could not be read as documents. Their original text is preserved exactly as captured and is never deleted automatically. Recovery always creates a detached copy, so no stored document can be replaced.</p>
              ${records
                .map((record) => {
                  const described = describeRecovery(record);
                  return `<div class="library-recovery-row" data-record="${escapeHtml(record.id)}">
                    <div class="library-row-main">
                      <div class="library-row-title"><b>${escapeHtml(described.label)}</b><span class="wb-chip warn">${escapeHtml(record.category)}</span></div>
                      <div class="library-row-meta">
                        <span>${escapeHtml(described.detail)}</span>
                        <span>CAPTURED ${escapeHtml(new Date(record.capturedAt).toLocaleString())}</span>
                      </div>
                      <p class="library-error">${escapeHtml(record.reason)}</p>
                    </div>
                    <div class="library-row-actions">
                      <button class="btn btn-ghost" data-lib="recovery-export" data-record="${escapeHtml(record.id)}">EXPORT RAW</button>
                      <button class="btn btn-ghost" data-lib="recovery-recover" data-record="${escapeHtml(record.id)}">RECOVER AS COPY</button>
                    </div>
                  </div>`;
                })
                .join('')}`
        }`;
    }
  };

  const reopen = (): void => {
    closeModal();
    window.setTimeout(() => openMissionLibrary(app, editor, storage), 0);
  };

  openModal({
    title: 'Mission library',
    wide: true,
    body: `
      <div class="mission-library">
        <div class="library-toolbar">
          <label class="library-search"><span>SEARCH</span><input id="library-search" type="search" placeholder="title, mission id or campaign" autocomplete="off"></label>
          <label class="library-sort"><span>SORT</span><select id="library-sort"><option value="recent">Recently edited</option><option value="title">Title</option><option value="mission">Mission ID</option></select></label>
          <button class="btn btn-primary" data-lib="new">NEW FROM CURRENT MAP</button>
        </div>
        <div class="library-meta" id="mission-library-status"></div>
        <div id="mission-library-list"></div>
        <div class="library-recovery" id="mission-library-recovery"></div>
      </div>`,
    actions: [{ label: 'Close' }],
    onMount: (root) => {
      renderList(root);
      root.querySelector<HTMLInputElement>('#library-search')?.addEventListener('input', (event) => {
        query = (event.target as HTMLInputElement).value;
        renderList(root);
      });
      root.querySelector<HTMLSelectElement>('#library-sort')?.addEventListener('change', (event) => {
        sort = (event.target as HTMLSelectElement).value as LibrarySort;
        renderList(root);
      });
      root.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-lib]');
        if (!button) return;
        const action = button.dataset.lib;
        const row = button.closest<HTMLElement>('[data-entry]');
        const entryId = row?.dataset.entry;
        if (action === 'new') {
          const created = ensureMissionForScenario(editor.scenario, {
            id: nextMissionIdForScenario(editor.scenario, read().entries),
          });
          try {
            const entry = saveScenarioToLibrary(storage, editor.scenario);
            closeModal();
            editor.openMissionWorkbench();
            app.notify(
              created.created
                ? `Mission draft created and saved as "${entry.title}".`
                : `Saved the current mission as "${entry.title}".`,
              'success',
            );
          } catch (error) {
            app.notify(
              `Could not create the mission: ${error instanceof Error ? error.message : String(error)}`,
              'critical',
            );
          }
          return;
        }
        if (action === 'recovery-export' || action === 'recovery-recover') {
          const id = button.dataset.record;
          const record = id
            ? readLibraryRecoveries(storage).records.find((item) => item.id === id)
            : undefined;
          if (!record) {
            app.notify('That preserved record is no longer available.', 'warning');
            return;
          }
          if (action === 'recovery-export') {
            downloadJson(recoveryFilename(record), record.raw);
            app.notify('Preserved record downloaded exactly as captured.', 'success');
            return;
          }
          openModal({
            title: 'Recover preserved record',
            body: `<p>The preserved payload is parsed with the same parser as a normal import and stored as a <b>new detached copy</b>. No existing library document is replaced, and campaign links are dropped.</p>
              <p class="wb-note">If it holds several documents or cannot be parsed, nothing is written and the raw export stays available.</p>`,
            actions: [
              { label: 'Cancel' },
              {
                label: 'Recover as copy',
                primary: true,
                onClick: () => {
                  try {
                    const entry = recoverLibraryRecord(storage, record, { host: editor.scenario });
                    app.notify(`Recovered as "${entry.title}".`, 'success');
                    reopen();
                  } catch (error) {
                    app.notify(
                      `Recovery failed: ${error instanceof Error ? error.message : String(error)}`,
                      'critical',
                    );
                  }
                },
              },
            ],
          });
          return;
        }
        if (!entryId) return;
        const entry = read().entries.find((item) => item.id === entryId);
        if (!entry) return;
        if (action === 'open') {
          try {
            const scenario = parseScenario(JSON.parse(entry.scenarioJson));
            closeModal();
            editor.loadScenario(scenario);
            editor.openMissionWorkbench();
            app.notify(`Opened "${entry.title}".`, 'success');
          } catch (error) {
            app.notify(
              `Could not open that document: ${error instanceof Error ? error.message : String(error)}. Its raw data is listed under Recovery.`,
              'critical',
            );
          }
          return;
        }
        if (action === 'export') {
          downloadJson(libraryFilename(entry.title, 'scenario'), entry.scenarioJson);
          app.notify('Scenario JSON downloaded.', 'success');
          return;
        }
        if (action === 'duplicate') {
          try {
            duplicateLibraryEntry(storage, entryId);
            app.notify('Duplicated as a detached mission.', 'success');
            reopen();
          } catch (error) {
            app.notify(
              `Could not duplicate: ${error instanceof Error ? error.message : String(error)}`,
              'critical',
            );
          }
          return;
        }
        if (action === 'delete') {
          openModal({
            title: 'Delete mission',
            body: `<p><b>${escapeHtml(entry.title)}</b> will be removed from the mission library. Battle saves, campaign progress, the Forge draft and the recovery archive are not touched.</p>`,
            actions: [
              { label: 'Cancel' },
              {
                label: 'Delete',
                danger: true,
                primary: true,
                onClick: () => {
                  try {
                    const removed = deleteLibraryEntry(storage, entryId);
                    if (!removed) {
                      app.notify('That document is no longer in the library.', 'warning');
                      reopen();
                      return;
                    }
                    app.notify('Mission removed from the library.', 'info');
                    reopen();
                  } catch (error) {
                    app.notify(
                      `Could not delete: ${error instanceof Error ? error.message : String(error)}. Nothing was removed.`,
                      'critical',
                    );
                  }
                },
              },
            ],
          });
        }
      });
    },
  });
}

/** Small helper used by the editor header; kept here so the note stays in one place. */
export function libraryEntryProtected(entry: MissionLibraryEntry): boolean {
  return entry.campaignId !== null;
}
