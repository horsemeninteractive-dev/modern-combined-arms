/**
 * Mission authoring workbench.
 *
 * The editor's `Scenario` is the only working document. Every control here
 * mutates the embedded `MissionDoc` in place; export and test launch read the
 * same object, so there is no authoring copy to drift from the shipped format.
 */
import type { App } from '../app';
import type { Editor } from './editor';
import { openModal, closeModal, escapeHtml } from './modal';
import {
  MISSION_FORMAT_VERSION,
  type ImportPreview,
  type LibraryStorage,
  type MissionAction,
  type MissionCinematicContext,
  type MissionCinematicDoc,
  type MissionCinematicStep,
  type MissionCondition,
  type MissionDoc,
  type MissionObjectiveKind,
  type MissionObjectiveState,
  type MissionResult,
  type MissionSection,
  type MissionTriggerDoc,
  type MissionValue,
  type MissionVariableType,
} from '../mission';
import {
  actionLabel,
  authoringIssues,
  authoredEntities,
  authoredEntityKeys,
  canRestoreLastValid,
  conditionLabel,
  copyOfImportedScenario,
  dependencyChain,
  describeAction,
  describeCondition,
  describeEntityReference,
  describeRecovery,
  draftExportJson,
  duplicateLibraryEntry,
  ensureMissionForScenario,
  focusForPath,
  formatByteSize,
  libraryFilename,
  libraryHealth,
  materialiseEntityKeys,
  missionJson,
  nextMissionIdForScenario,
  objectiveDependents,
  objectiveReferences,
  openingVisibility,
  overlappingRegions,
  parseMissionValue,
  previewImport,
  readLibraryRecoveries,
  readMissionLibrary,
  recoverLibraryRecord,
  recoveryFilename,
  regionBoundsLabel,
  regionReferences,
  saveScenarioToLibrary,
  scenarioForImportedMission,
  scenarioJsonForExport,
  sectionForPath,
  triggerPolicyLabel,
  variableReferences,
  wouldCreateDependencyCycle,
  type MissionFocus,
} from '../mission';
import { missionBriefingMarkup } from './missionBriefing';
import { missionDebriefMarkup } from './missionDebrief';
import { copyText, downloadJson, readFileText } from './jsonFile';
import { CAMPAIGNS } from '../data/campaign';
import { UNITS } from '../data/units';
import { parseScenario, scenarioToJson } from '../sim/scenario';

const SECTIONS: Array<{ id: MissionSection; label: string; note: string }> = [
  { id: 'overview', label: 'MISSION', note: 'Identity, campaign link and library actions' },
  { id: 'briefing', label: 'BRIEFING', note: 'Dossier, objectives copy and debrief prose' },
  { id: 'objectives', label: 'OBJECTIVES', note: 'Primary, secondary and bonus tasks' },
  { id: 'variables', label: 'VARIABLES', note: 'Typed mission state' },
  { id: 'regions', label: 'REGIONS', note: 'Tile rectangles used by triggers' },
  { id: 'triggers', label: 'TRIGGERS', note: 'Conditions, actions and firing policy' },
  { id: 'aiGroups', label: 'AI GROUPS', note: 'Reserves, ambushes and their release' },
  { id: 'reinforcements', label: 'REINFORCEMENTS', note: 'Waves, arrival and composition' },
  { id: 'cinematics', label: 'CINEMATICS', note: 'Ordered camera and dialogue beats' },
  { id: 'validation', label: 'VALIDATE', note: 'Diagnostics and test launch' },
  { id: 'recovery', label: 'RECOVERY', note: 'Draft, saved copy, snapshots and storage' },
];

const OBJECTIVE_KINDS: MissionObjectiveKind[] = ['primary', 'secondary', 'bonus'];
const OBJECTIVE_STATES: MissionObjectiveState[] = ['hidden', 'active', 'complete', 'failed'];
const CINEMATIC_KINDS: MissionCinematicContext[] = [
  'opening',
  'inMission',
  'intermission',
  'ending',
];
const VARIABLE_TYPES: MissionVariableType[] = ['number', 'boolean', 'string'];
const COMPARE_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;
const CONDITION_KINDS: MissionCondition['kind'][] = [
  'elapsed',
  'variable',
  'objective',
  'entityAlive',
  'entityDead',
  'regionOccupied',
];
const AI_TASKS = ['attack', 'defend', 'patrol', 'reinforce'] as const;
const ACTION_KINDS: MissionAction['kind'][] = [
  'setObjective',
  'setVariable',
  'message',
  'activateAiGroup',
  'spawnReinforcement',
  'endMission',
];

function unitDefName(defId: string): string {
  return UNITS[defId as keyof typeof UNITS]?.name ?? defId;
}

function num(value: string, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function option(value: string, label: string, current: string): string {
  return `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function field(label: string, control: string, note = ''): string {
  return `<label class="wb-field"><span>${label}</span>${control}${note ? `<small>${note}</small>` : ''}</label>`;
}

function officialCampaignMission(mission: MissionDoc): boolean {
  return CAMPAIGNS.some((campaign) =>
    campaign.missions.some((entry) => entry.mission.id === mission.id || entry.id === mission.id),
  );
}

export class MissionWorkbench {
  private root: HTMLDivElement | null = null;
  private section: MissionSection = 'overview';
  private entryId: string | null = null;
  private dirty = false;
  private savedMissionJson = '';
  private showRegions = true;
  private scrollTop = 0;
  /** Last library write failure, cleared by a successful save. */
  private storageError: string | null = null;
  /** Region the region tool and the map overlay treat as current. */
  private selectedRegionId: string | null = null;
  /** Deep-link target from a diagnostic, applied after the next render. */
  private focusKey: string | null = null;
  /** Authored placement ringed on the map by a reference row. */
  private highlightKey: string | null = null;

  constructor(
    private readonly app: App,
    private readonly editor: Editor,
    private readonly storage: LibraryStorage = localStorage,
  ) {}

  get active(): boolean {
    return this.root !== null;
  }

  get currentEntryId(): string | null {
    return this.entryId;
  }

  /** Current section, so a test run can reopen the document where it left off. */
  get currentSection(): MissionSection {
    return this.section;
  }

  open(section?: MissionSection): void {
    if (section) this.section = section;
    this.editor.onRegionEdited = () => {
      // A map gesture wrote the document; the panel re-reads it rather than
      // keeping its own copy of the selected rectangle.
      this.selectedRegionId = this.editor.selectedRegionId;
      this.refresh();
    };
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.id = 'mission-workbench-root';
      this.root.className = 'mission-workbench-root';
      this.root.addEventListener('click', this.onClick);
      this.root.addEventListener('change', this.onChange);
    }
    // The workbench is a view of the Forge's authoring column, not a floating
    // window: docking it means the panel rail, the map tools and the mission
    // document are never competing for the same corner of the screen.
    const host = this.editor.missionWorkbenchHost ?? document.body;
    if (this.root.parentElement !== host) host.appendChild(this.root);
    this.anchor();
    this.showRegions = this.editor.showRegions;
    this.render();
    this.root.classList.remove('hidden');
    document.body.classList.add('workbench-open');
    this.editor.showRegions = this.showRegions;
    this.editor.selectRegion(this.selectedRegionId);
    this.root.querySelector<HTMLElement>(`[data-section="${this.section}"]`)?.focus({ preventScroll: true });
  }

  close(force = false): void {
    if (!this.root) return;
    if (!force && this.dirty) {
      openModal({
        title: 'Discard workbench changes?',
        body: `<p>This mission has edits that are not in the library. The Scenario Forge autosave still holds them, but closing the workbench discards the library comparison.</p>`,
        actions: [
          { label: 'Keep editing' },
          {
            label: 'Discard and close',
            primary: true,
            onClick: () => this.close(true),
          },
        ],
      });
      return;
    }
    this.root.classList.add('hidden');
    this.root.remove();
    this.root = null;
    document.body.classList.remove('workbench-open');
    this.editor.workbenchClosed();
    this.editor.showRegions = false;
    this.editor.setRegionTool('off');
    this.editor.setEntityHighlight(null);
    this.editor.onRegionEdited = null;
  }

  refresh(): void {
    if (this.root) this.render();
  }

  /** Open a section from its top: a shared scroll offset lands mid-card. */
  private showSection(id: MissionSection): void {
    this.section = id;
    this.scrollTop = 0;
    this.render();
  }

  /** Re-anchor after a different scenario was loaded into the editor. */
  reload(): void {
    if (!this.root) return;
    this.anchor();
    this.render();
  }

  /**
   * Point the unsaved-edits indicator at the stored library copy.
   *
   * The baseline is the saved document, never the in-memory one, so reopening
   * the workbench cannot pretend a divergent draft is already stored.
   */
  private anchor(): void {
    this.entryId = this.findEntryId();
    const entry = this.entryId ? this.entries().find((item) => item.id === this.entryId) : undefined;
    this.savedMissionJson = entry ? this.missionJsonOf(entry.scenarioJson) : '';
    this.recomputeDirty();
  }

  /**
   * Compare the working document with the stored copy through one canonical pass.
   *
   * Raw `JSON.stringify` output differs by property order between a freshly
   * constructed mission and a parsed one, which made a just-saved document look
   * unsaved. Canonicalising both sides removes that false signal without hiding
   * real edits.
   */
  private recomputeDirty(): void {
    const mission = this.mission();
    if (!mission) {
      this.dirty = false;
      return;
    }
    this.dirty = !this.entryId || this.canonicalMissionJson() !== this.savedMissionJson;
  }

  private canonicalMissionJson(): string {
    try {
      return this.missionJsonOf(scenarioToJson(this.editor.scenario));
    } catch {
      // An invalid document is by definition not the stored one.
      return JSON.stringify(this.mission() ?? {});
    }
  }

  private missionJsonOf(scenarioJson: string): string {
    try {
      const scenario = parseScenario(JSON.parse(scenarioJson));
      return scenario.mission ? JSON.stringify(scenario.mission) : '';
    } catch {
      return '';
    }
  }

  /** Preserved records waiting in the recovery area, if any. */
  private recoveryCount(): number {
    try {
      return readLibraryRecoveries(this.storage).records.length;
    } catch {
      return 0;
    }
  }

  private findEntryId(): string | null {
    const mission = this.editor.scenario.mission;
    if (!mission) return null;
    try {
      const { doc } = readMissionLibrary(this.storage);
      return doc.entries.find((entry) => entry.missionId === mission.id)?.id ?? null;
    } catch {
      return null;
    }
  }

  private entries() {
    try {
      return readMissionLibrary(this.storage).doc.entries;
    } catch {
      return [];
    }
  }

  private mission(): MissionDoc | null {
    return this.editor.scenario.mission ?? null;
  }

  private campaignLocked(): boolean {
    const entry = this.entries().find((item) => item.id === this.entryId);
    return Boolean(entry?.campaignId) || (this.mission() ? officialCampaignMission(this.mission()!) : false);
  }

  private commit(): void {
    this.recomputeDirty();
    this.editor.missionChanged();
    this.render();
  }

  private render(): void {
    if (!this.root) return;
    const body = this.root.querySelector('.wb-body');
    if (body) this.scrollTop = body.scrollTop;
    this.root.innerHTML = this.shell();
    // Region authoring needs the map visible. On a small landscape screen the
    // panel fills the viewport by default, so it narrows while a map tool owns
    // the pointer and gives the map back its working area.
    this.root.classList.toggle('region-mode', this.editor.regionTool !== 'off');
    const next = this.root.querySelector<HTMLElement>('.wb-body');
    if (next) next.scrollTop = this.scrollTop;
    this.applyFocus();
  }

  /**
   * Bring a diagnostic's target into view once its section has rendered.
   *
   * The panel is rebuilt from the document on every edit, so the flash and the
   * scroll have to happen after the new markup exists; a stale element reference
   * from before the render would scroll nothing.
   */
  /**
   * Open the section, item and map object a diagnostic belongs to.
   *
   * Section routing alone was not enough: an author clicking "objective has no
   * completion" landed at the top of a long list. The focus key scrolls to the
   * exact card, and a region or placement is framed on the map behind the panel.
   */
  private jumpTo(path: string): void {
    const doc = this.mission();
    if (!doc) return;
    const focus: MissionFocus = focusForPath(path, doc);
    this.section = focus.section;
    if (focus.objectiveIndex !== undefined) this.focusKey = `objective:${focus.objectiveIndex}`;
    else if (focus.triggerIndex !== undefined) this.focusKey = `trigger:${focus.triggerIndex}`;
    else if (focus.regionIndex !== undefined) this.focusKey = `region:${focus.regionIndex}`;
    else if (focus.cinematicIndex !== undefined) this.focusKey = `cinematic:${focus.cinematicIndex}`;
    else if (focus.entityKey && doc.entities.some((entry) => entry.key === focus.entityKey)) {
      this.focusKey = null;
    }
    if (focus.regionId) {
      this.selectedRegionId = focus.regionId;
      this.showRegions = true;
      this.editor.showRegions = true;
      this.editor.selectRegion(focus.regionId);
    }
    if (focus.entityKey) {
      this.highlightKey = focus.entityKey;
      this.editor.setEntityHighlight(focus.entityKey);
      if (describeEntityReference(this.editor.scenario, focus.entityKey).found) {
        this.editor.focusEntity(focus.entityKey);
      }
    }
    this.render();
  }

  private applyFocus(): void {
    const key = this.focusKey;
    if (!key || !this.root) return;
    this.focusKey = null;
    const target = this.root.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.classList.add('wb-focus');
    // Focus a field, never a card action: landing the caret on REMOVE would make
    // a stray Enter destructive.
    const field = target.querySelector<HTMLElement>('input, select, textarea');
    field?.focus({ preventScroll: true });
    window.setTimeout(() => target.classList.remove('wb-focus'), 1600);
  }

  private shell(): string {
    const mission = this.mission();
    const issues = this.missionIssues();
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    const locked = this.campaignLocked();
    return `
      <div class="wb-panel" role="region" aria-label="Mission authoring workbench">
        <header class="wb-head">
          <div class="wb-title">
            <span>MISSION WORKBENCH</span>
            <b>${escapeHtml(mission?.title ?? 'No mission document')}</b>
            <small>${escapeHtml(this.editor.scenario.meta.name)} · ${this.editor.scenario.width}×${this.editor.scenario.height}</small>
          </div>
          <div class="wb-state">
            ${locked ? '<span class="wb-badge locked">CAMPAIGN COPY · READ ONLY</span>' : ''}
            ${this.dirty || !this.entryId ? '<span class="wb-badge dirty">UNSAVED EDITS</span>' : '<span class="wb-badge ok">IN LIBRARY</span>'}
            ${mission ? `<span class="wb-badge ${errors ? 'bad' : warnings ? 'warn' : 'ok'}">${errors} ERR · ${warnings} WARN</span>` : ''}
            ${this.storageError ? '<span class="wb-badge bad">STORAGE ERROR</span>' : ''}
            ${this.recoveryCount() ? '<span class="wb-badge warn">RECOVERY</span>' : ''}
            <button class="btn btn-ghost" data-act="library">LIBRARY</button>
            <button class="btn btn-ghost" data-act="close">CLOSE</button>
          </div>
        </header>
        <nav class="wb-tabs" aria-label="Mission sections">
          ${SECTIONS.map(
            (section) =>
              `<button type="button" class="wb-tab ${section.id === this.section ? 'active' : ''}" data-section="${section.id}" aria-pressed="${section.id === this.section}">${section.label}<small>${escapeHtml(section.note)}</small></button>`,
          ).join('')}
        </nav>
        <div class="wb-body">${this.content()}</div>
        <footer class="wb-foot">
          <span>${mission ? `MISSION ${escapeHtml(mission.id)} · FORMAT v${mission.version}` : 'NO MISSION DOCUMENT'}</span>
          <span>${this.entryId ? `LIBRARY ${escapeHtml(this.entryId)}` : 'NOT YET IN LIBRARY'}</span>
          <button class="btn btn-primary" data-act="test" ${!mission || errors ? 'disabled' : ''}>TEST OPERATION</button>
        </footer>
      </div>`;
  }

  private content(): string {
    if (!this.mission()) return this.noMission();
    switch (this.section) {
      case 'overview':
        return this.overview();
      case 'briefing':
        return this.briefing();
      case 'objectives':
        return this.objectives();
      case 'variables':
        return this.variables();
      case 'regions':
        return this.regions();
      case 'triggers':
        return this.triggers();
      case 'aiGroups':
        return this.aiGroups();
      case 'reinforcements':
        return this.reinforcements();
      case 'cinematics':
        return this.cinematics();
      case 'validation':
        return this.validation();
      case 'recovery':
        return this.recovery();
    }
  }

  private noMission(): string {
    return `
      <section class="wb-section wb-empty">
        <h3>This scenario has no mission document.</h3>
        <p>A draft adds a primary objective, command-post entity keys, an opening briefing and the two command-post triggers the runtime can actually observe. Existing authored keys are never rewritten.</p>
        <button class="btn btn-primary" data-act="create-mission">CREATE MISSION DRAFT</button>
      </section>`;
  }

  private toolbar(): string {
    const locked = this.campaignLocked();
    return `<div class="wb-toolbar">
      <button class="btn btn-primary" data-act="save" ${locked ? 'disabled' : ''}>SAVE TO LIBRARY</button>
      ${locked ? '<button class="btn btn-ghost" data-act="save-copy">SAVE AS COPY</button>' : ''}
      <button class="btn btn-ghost" data-act="export-mission">EXPORT MISSION JSON</button>
      <button class="btn btn-ghost" data-act="export-scenario">EXPORT SCENARIO</button>
      <button class="btn btn-ghost" data-act="copy-mission">COPY MISSION JSON</button>
      <button class="btn btn-ghost" data-act="import">IMPORT JSON</button>
      ${this.entryId ? '<button class="btn btn-ghost" data-act="revert">REVERT TO SAVED</button>' : ''}
      ${canRestoreLastValid(this.entries().find((item) => item.id === this.entryId)) ? '<button class="btn btn-ghost" data-act="restore-valid">RESTORE LAST VALID</button>' : ''}
    </div>`;
  }

  private overview(): string {
    const doc = this.mission()!;
    const entry = this.entries().find((item) => item.id === this.entryId);
    const commander = this.app.missionCommander();
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-grid two">
          <div class="wb-card">
            <h3>Identity</h3>
            ${field('Mission ID', `<input data-scope="mission" data-field="id" value="${escapeHtml(doc.id)}" spellcheck="false">`, 'Stable reference. Renaming the title never changes it.')}
            ${field('Title', `<input data-scope="mission" data-field="title" value="${escapeHtml(doc.title)}">`)}
            ${field('Description', `<textarea rows="3" data-scope="mission" data-field="description">${escapeHtml(doc.description)}</textarea>`)}
            ${field('Author', `<input data-scope="mission" data-field="author" value="${escapeHtml(doc.author ?? '')}">`)}
            <div class="wb-inline">
              <span class="wb-chip">FORMAT ${escapeHtml(doc.format)}</span>
              <span class="wb-chip">VERSION ${doc.version}</span>
              <span class="wb-chip">BUILD ${MISSION_FORMAT_VERSION}</span>
              ${entry ? `<span class="wb-chip">LIBRARY ${escapeHtml(entry.id)}</span>` : '<span class="wb-chip">UNSAVED</span>'}
            </div>
          </div>
          <div class="wb-card">
            <h3>Campaign association</h3>
            <p class="wb-note">Standalone missions leave these blank. Campaign metadata is how a mission document identifies its operation; the library keeps that association and protects the copy.</p>
            ${field('Campaign ID', `<input data-scope="campaign" data-field="campaignId" value="${escapeHtml(doc.campaign?.campaignId ?? '')}" placeholder="standalone" spellcheck="false">`)}
            ${field('Order', `<input type="number" min="1" step="1" data-scope="campaign" data-field="order" value="${doc.campaign?.order ?? 1}">`)}
            ${field('Side', `<select data-scope="campaign" data-field="side">${option('', 'Unspecified', doc.campaign?.side ?? '')}${option('defender', 'Defender', doc.campaign?.side ?? '')}${option('eastern', 'Eastern', doc.campaign?.side ?? '')}</select>`)}
            <p class="wb-note">${doc.campaign ? `Bound to campaign <b>${escapeHtml(doc.campaign.campaignId)}</b> at order ${doc.campaign.order}.` : 'Standalone document.'}</p>
          </div>
        </div>
        <div class="wb-card">
          <h3>Authored placements</h3>
          <p class="wb-note">Mission fields point at these stable keys, never at map positions, so moving a placement keeps every reference intact.</p>
          <div class="wb-ref-list">${
            authoredEntities(this.editor.scenario)
              .map(
                (entry) => `<div class="wb-ref-row ok">
                  <span class="wb-chip ${entry.kind === 'structure' ? 'primary' : 'bonus'}">${entry.kind.toUpperCase()}</span>
                  <span class="wb-ref-name"><b>${escapeHtml(entry.defName)}</b><small>${escapeHtml(entry.ownerName)} · tile ${entry.x}, ${entry.z}</small><code>${escapeHtml(entry.key)}</code></span>
                  <span class="wb-row-actions"><button class="btn btn-ghost" data-act="focus-entity" data-key="${escapeHtml(entry.key)}">LOCATE</button></span>
                </div>`,
              )
              .join('') || '<p class="wb-note">No keyed placements yet. Keying a placement is what lets a mission observe it.</p>'
          }</div>
          ${this.unkeyedCount() ? `<p class="wb-ref-warning"><b>${this.unkeyedCount()} UNKEYED</b> placements cannot be referenced by a mission yet. Assigning keys rewrites nothing that already has one.</p><button class="btn btn-ghost" data-act="key-placements">ASSIGN KEYS</button>` : ''}
        </div>
        <div class="wb-card">
          <h3>Dossier preview</h3>
          <p class="wb-note">This is the exact dossier component the campaign deck and F1 briefing use. Hidden objectives are omitted.</p>
          ${missionBriefingMarkup(doc, { commander })}
        </div>
      </section>`;
  }

  /** Placements a mission cannot reference until they are given a key. */
  private unkeyedCount(): number {
    const scenario = this.editor.scenario;
    return scenario.structures.filter((entry) => !entry.key).length +
      scenario.units.filter((entry) => !entry.key).length;
  }

  private briefing(): string {
    const doc = this.mission()!;
    const briefing = doc.briefing;
    const commander = this.app.missionCommander();
    const list = (key: 'personnel' | 'instructions', values: readonly string[] | undefined) =>
      (values ?? [])
        .map(
          (value, index) => `
            <div class="wb-list-row">
              <input data-scope="briefList" data-list="${key}" data-index="${index}" value="${escapeHtml(value)}">
              <button class="btn btn-ghost" data-act="remove-brief-list" data-list="${key}" data-index="${index}" aria-label="Remove entry">REMOVE</button>
            </div>`,
        )
        .join('');
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-grid two">
          <div class="wb-card">
            <h3>Situation</h3>
            ${field('Summary', `<textarea rows="3" data-scope="briefing" data-field="summary">${escapeHtml(briefing.summary)}</textarea>`)}
            ${field('Subtitle', `<input data-scope="briefing" data-field="subtitle" value="${escapeHtml(briefing.subtitle ?? '')}">`)}
            ${field('Strategic context', `<textarea rows="3" data-scope="briefing" data-field="context">${escapeHtml(briefing.context ?? '')}</textarea>`)}
            ${field('Commander note', `<textarea rows="2" data-scope="briefing" data-field="commanderNote">${escapeHtml(briefing.commanderNote ?? '')}</textarea>`, 'Use {{name}} and {{callsign}} for the campaign commander.')}
          </div>
          <div class="wb-card">
            <h3>Forces and intent</h3>
            ${field('Friendly forces', `<textarea rows="2" data-scope="briefing" data-field="friendly">${escapeHtml(briefing.friendly)}</textarea>`)}
            ${field('Enemy situation', `<textarea rows="2" data-scope="briefing" data-field="enemy">${escapeHtml(briefing.enemy)}</textarea>`)}
            ${field('Enemy intent', `<textarea rows="2" data-scope="briefing" data-field="enemyIntent">${escapeHtml(briefing.enemyIntent ?? '')}</textarea>`)}
          </div>
        </div>
        <div class="wb-grid two">
          <div class="wb-card">
            <h3>Named personnel</h3>
            ${list('personnel', briefing.personnel) || '<p class="wb-note">No named personnel yet.</p>'}
            <button class="btn btn-ghost" data-act="add-brief-list" data-list="personnel">ADD PERSON</button>
          </div>
          <div class="wb-card">
            <h3>Operational instructions</h3>
            ${list('instructions', briefing.instructions) || '<p class="wb-note">No instructions yet.</p>'}
            <button class="btn btn-ghost" data-act="add-brief-list" data-list="instructions">ADD INSTRUCTION</button>
          </div>
        </div>
        <div class="wb-grid two">
          <div class="wb-card">
            <h3>Debrief copy</h3>
            ${field('Victory', `<textarea rows="3" data-scope="debrief" data-field="victory">${escapeHtml(doc.debrief?.victory ?? '')}</textarea>`, 'Narrative framing only. Facts come from MissionResult.')}
            ${field('Defeat', `<textarea rows="3" data-scope="debrief" data-field="defeat">${escapeHtml(doc.debrief?.defeat ?? '')}</textarea>`)}
          </div>
          <div class="wb-card">
            <h3>Debrief preview</h3>
            <p class="wb-note">Sample states, zeroed counters. The real debrief reads the captured result.</p>
            ${missionDebriefMarkup(this.sampleResult(), { mission: doc })}
          </div>
        </div>
        <div class="wb-card">
          <h3>Briefing preview</h3>
          ${missionBriefingMarkup(doc, { commander })}
        </div>
      </section>`;
  }

  private sampleResult(): MissionResult {
    const doc = this.mission()!;
    return {
      missionId: doc.id,
      outcome: 'victory',
      tick: 0,
      elapsedSeconds: 0,
      objectives: doc.objectives.map((objective) => ({
        id: objective.id,
        title: objective.title,
        kind: objective.kind,
        state: objective.kind === 'primary' ? 'complete' : 'active',
      })),
      friendly: { unitsBuilt: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0, matsGathered: 0 },
      enemy: { unitsLost: 0, kills: 0 },
      entities: doc.entities.map((entity) => ({
        key: entity.key,
        ...(entity.name ? { name: entity.name } : {}),
        role: entity.role,
        survived: true,
      })),
    };
  }

  private objectives(): string {
    const doc = this.mission()!;
    const keys = authoredEntityKeys(this.editor.scenario);
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-section-head">
          <div><h3>Objective tree</h3><p>Dependencies are authored, not inferred. All conditions on a trigger are ANDed; an objective becomes active only after every dependency is complete.</p></div>
          <button class="btn btn-ghost" data-act="add-objective">ADD OBJECTIVE</button>
        </div>
        ${doc.objectives
          .map((objective, index) => {
            const refs = objectiveReferences(doc, objective.id);
            const visible = openingVisibility(objective);
            const dependents = objectiveDependents(doc, objective.id);
            const chain = dependencyChain(doc, objective.id).filter((path) => path.length > 1);
            const protectedKeys = objective.protectedEntities ?? [];
            return `<article class="wb-card objective" data-objective-card="${index}" data-focus-key="objective:${index}">
              <header class="wb-card-head">
                <span class="wb-index">${String(index + 1).padStart(2, '0')}</span>
                <b>${escapeHtml(objective.title || 'Untitled objective')}</b>
                <span class="wb-chip ${objective.kind}">${objective.kind.toUpperCase()}</span>
                <span class="wb-chip">${visible === 'hidden' ? 'OPENS HIDDEN' : 'OPENS ACTIVE'}</span>
                <button class="btn btn-ghost" data-act="remove-objective" data-index="${index}">REMOVE</button>
              </header>
              <div class="wb-grid four">
                ${field('ID', `<input data-scope="objective" data-index="${index}" data-field="id" value="${escapeHtml(objective.id)}" spellcheck="false">`)}
                ${field('Title', `<input data-scope="objective" data-index="${index}" data-field="title" value="${escapeHtml(objective.title)}">`)}
                ${field('Category', `<select data-scope="objective" data-index="${index}" data-field="kind">${OBJECTIVE_KINDS.map((kind) => option(kind, kind, objective.kind)).join('')}</select>`)}
                ${field('Opening visibility', `<select data-scope="objective" data-index="${index}" data-field="initialState">${option('active', 'Active', objective.initialState ?? 'active')}${option('hidden', 'Hidden', objective.initialState ?? 'active')}</select>`, 'Dependencies still gate activation.')}
              </div>
              ${field('Description', `<textarea rows="2" data-scope="objective" data-index="${index}" data-field="description">${escapeHtml(objective.description ?? '')}</textarea>`)}
              <div class="wb-grid two">
                <div>
                  <span class="wb-label">DEPENDS ON (PREREQUISITES)</span>
                  <div class="wb-checks">${
                    doc.objectives
                      .filter((other) => other.id !== objective.id)
                      .map((other) => {
                        const checked = objective.dependsOn.includes(other.id);
                        const cycle = !checked && wouldCreateDependencyCycle(doc, objective.id, other.id);
                        return `<label class="${cycle ? 'blocked' : ''}" title="${cycle ? 'Adding this prerequisite would close a dependency loop.' : `Reference: ${other.id}`}"><input type="checkbox" data-scope="objective-dep" data-index="${index}" data-value="${escapeHtml(other.id)}" ${checked ? 'checked' : ''} ${cycle ? 'disabled' : ''}> ${escapeHtml(other.title || other.id)} <code>${escapeHtml(other.id)}</code>${cycle ? ' <span class="wb-chip bad">CYCLE</span>' : ''}</label>`;
                      })
                      .join('') || '<small>No other objectives to depend on.</small>'
                  }</div>
                  ${chain.length ? `<p class="wb-note">Prerequisite chains: ${chain.map((path) => escapeHtml(path.join(' ← '))).join(' · ')}</p>` : ''}
                </div>
                <div>
                  <span class="wb-label">REQUIRED BY (DEPENDENTS)</span>
                  <div class="wb-checks">${
                    dependents
                      .map(
                        (entry) =>
                          `<button class="wb-link" data-act="goto-objective" data-index="${entry.index}">${escapeHtml(entry.title || entry.id)} <code>${escapeHtml(entry.id)}</code></button>`,
                      )
                      .join('') || '<small>Nothing depends on this objective.</small>'
                  }</div>
                  <p class="wb-note">Dependencies are authored by objective <b>id</b>. Titles are labels only; renaming a title leaves relationships intact, renaming an id breaks them.</p>
                </div>
              </div>
              <div>
                <span class="wb-label">PROTECTED AUTHORED ENTITIES</span>
                <div class="wb-ref-list">${
                  protectedKeys
                    .map((key) => this.entityReferenceRow(key, `data-act="remove-protected-entity" data-index="${index}" data-value="${escapeHtml(key)}"`, { pick: `data-act="pick-objective-entity" data-index="${index}" data-value="${escapeHtml(key)}"` }))
                    .join('') || '<p class="wb-note">No protected placements. A protected entity is reported as survived or lost in the mission result.</p>'
                }</div>
                ${
                  keys.filter((key) => !protectedKeys.includes(key)).length
                    ? `<div class="wb-inline wb-ref-add">
                        <select data-scope="objective-entity-add" data-index="${index}" aria-label="Add a protected authored entity">
                          <option value="">Add a protected placement…</option>
                          ${keys.filter((key) => !protectedKeys.includes(key)).map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(this.entityOptionLabel(key))}</option>`).join('')}
                        </select>
                        <button class="btn btn-ghost" data-act="pick-objective-entity" data-index="${index}">PICK ON MAP</button>
                      </div>`
                    : '<p class="wb-note">Every keyed placement is already protected here.</p>'
                }
              </div>
              <p class="wb-note">${visible === 'hidden' ? 'Opens hidden: it waits for a trigger or for its dependencies to complete.' : 'Opens active.'}${refs.length ? ` · Referenced by ${refs.length} other authoring location${refs.length === 1 ? '' : 's'}.` : ''} · Only a trigger action can complete it.</p>
            </article>`;
          })
          .join('') || '<p class="wb-note">No objectives. A mission needs at least one primary objective.</p>'}
      </section>`;
  }

  /* ------------------------------------------------------------------ */
  /* Reference presentation                                              */
  /* ------------------------------------------------------------------ */

  /** Readable `<key> · <def name>` for a picker option. */
  private entityOptionLabel(key: string): string {
    const info = describeEntityReference(this.editor.scenario, key);
    return `${key} · ${info.label}`;
  }

  /**
   * One authored-entity reference: state, readable identity, and the actions.
   *
   * A missing key is shown as missing with its exact text, never replaced by a
   * similar-looking placement: silently retargeting a reference would change
   * what the mission means without the author agreeing to it.
   */
  private entityReferenceRow(
    key: string,
    removeAttrs: string,
    opts: { pick?: string } = {},
  ): string {
    const info = describeEntityReference(this.editor.scenario, key);
    const active = this.highlightKey === key;
    return `<div class="wb-ref-row ${info.found ? 'ok' : 'bad'} ${active ? 'active' : ''}">
      <span class="wb-chip ${info.found ? 'ok' : 'bad'}">${info.found ? 'LINKED' : 'MISSING'}</span>
      <span class="wb-ref-name"><b>${escapeHtml(info.label)}</b><small>${escapeHtml(info.detail)}</small><code>${escapeHtml(key || '—')}</code></span>
      <span class="wb-row-actions">
        ${info.found ? `<button class="btn btn-ghost" data-act="focus-entity" data-key="${escapeHtml(key)}">LOCATE</button>` : ''}
        ${opts.pick ? `<button class="btn btn-ghost" ${opts.pick}>PICK</button>` : ''}
        <button class="btn btn-ghost" ${removeAttrs}>REMOVE</button>
      </span>
    </div>`;
  }

  /** A select for authored keys, plus the state row and map actions. */
  private entitySelectField(
    key: string,
    select: string,
    pickAttrs: string,
    clearAttrs: string,
    label = 'Authored placement',
  ): string {
    const info = describeEntityReference(this.editor.scenario, key);
    return `<div class="wb-ref-field">
      ${info.found ? '' : `<p class="wb-ref-warning"><b>${key ? 'MISSING' : 'UNSET'}</b> ${escapeHtml(info.detail)}</p>`}
      ${field(label, `<div class="wb-inline wb-ref-control">${select}<button type="button" class="btn btn-ghost" ${pickAttrs}>PICK ON MAP</button>${info.found ? `<button type="button" class="btn btn-ghost" data-act="focus-entity" data-key="${escapeHtml(key)}">LOCATE</button>` : ''}${key ? `<button type="button" class="btn btn-ghost" ${clearAttrs}>CLEAR</button>` : ''}</div>`, info.found ? info.detail : 'No matching authored placement in this scenario.')}
    </div>`;
  }

  /** Resolve the next map click to a key and apply it to the authored field. */
  private beginEntityPick(apply: (key: string) => void): void {
    this.editor.pickEntityOnMap((key) => {
      if (!key) {
        this.render();
        return;
      }
      apply(key);
      this.highlightKey = key;
      this.editor.setEntityHighlight(key);
      this.commit();
    });
  }

  private variables(): string {
    const doc = this.mission()!;
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-section-head">
          <div><h3>Mission variables</h3><p>Typed values only. Triggers may compare them and write them; there are no expressions or scripts.</p></div>
          <button class="btn btn-ghost" data-act="add-variable">ADD VARIABLE</button>
        </div>
        ${doc.variables
          .map((variable, index) => {
            const refs = variableReferences(doc, variable.id);
            return `<article class="wb-card">
              <header class="wb-card-head"><b>${escapeHtml(variable.id)}</b><span class="wb-chip">${variable.type.toUpperCase()}</span>${refs.length ? `<span class="wb-chip">${refs.length} REFERENCE${refs.length === 1 ? '' : 'S'}</span>` : ''}<button class="btn btn-ghost" data-act="remove-variable" data-index="${index}">REMOVE</button></header>
              <div class="wb-grid three">
                ${field('ID', `<input data-scope="variable" data-index="${index}" data-field="id" value="${escapeHtml(variable.id)}" spellcheck="false">`)}
                ${field('Type', `<select data-scope="variable" data-index="${index}" data-field="type">${VARIABLE_TYPES.map((type) => option(type, type, variable.type)).join('')}</select>`)}
                ${field('Default', this.variableValueControl(variable.type, variable.default, `data-scope="variable" data-index="${index}" data-field="default"`))}
              </div>
              ${field('Description', `<input data-scope="variable" data-index="${index}" data-field="description" value="${escapeHtml(variable.description ?? '')}">`)}
              ${refs.length ? `<p class="wb-note">Used at ${refs.map(escapeHtml).join(', ')}</p>` : ''}
            </article>`;
          })
          .join('') || '<p class="wb-note">No variables. Trigger comparisons can use elapsed time and objective state without them.</p>'}
      </section>`;
  }

  private variableValueControl(type: MissionVariableType, value: MissionValue, attrs: string): string {
    if (type === 'boolean') {
      return `<select ${attrs}>${option('true', 'true', String(value))}${option('false', 'false', String(value))}</select>`;
    }
    if (type === 'number') {
      return `<input type="number" step="any" ${attrs} value="${escapeHtml(String(value))}">`;
    }
    return `<input ${attrs} value="${escapeHtml(String(value))}">`;
  }

  private regions(): string {
    const doc = this.mission()!;
    const tool = this.editor.regionTool;
    const gesture = this.editor.regionGestureActive;
    const selected = doc.regions.find((entry) => entry.id === this.selectedRegionId) ?? null;
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-section-head">
          <div><h3>Tile regions</h3><p>Draw, move and resize rectangles on the map, then fine-tune the exact tiles here. A region covers its top-left tile plus width×height tiles — the same numbers a region condition reads at runtime.</p></div>
          <div class="wb-actions">
            <button class="btn ${tool === 'draw' ? 'btn-primary' : 'btn-ghost'}" data-act="region-draw" aria-pressed="${tool === 'draw'}">DRAW ON MAP</button>
            <button class="btn ${tool === 'select' ? 'btn-primary' : 'btn-ghost'}" data-act="region-select" aria-pressed="${tool === 'select'}">SELECT ON MAP</button>
            <button class="btn btn-ghost" data-act="region-tool-off" ${tool === 'off' ? 'disabled' : ''}>STOP</button>
            <button class="btn btn-ghost" data-act="toggle-regions">${this.showRegions ? 'HIDE OVERLAY' : 'SHOW OVERLAY'}</button>
          </div>
        </div>
        <div class="wb-tool-state" role="status" aria-live="polite">
          <span class="wb-chip ${tool === 'off' ? '' : 'warn'}">${tool === 'off' ? 'MAP TOOL OFF' : tool === 'draw' ? 'DRAW MODE' : 'SELECT MODE'}</span>
          <span>${tool === 'off'
            ? 'The normal forge tools are unaffected while region authoring is off.'
            : 'The map now only edits regions: painting, placement and erase are suspended until you stop. Right or middle drag still pans.'}</span>
          ${gesture ? '<span class="wb-chip warn">DRAGGING</span>' : ''}
          ${tool === 'off' ? '' : '<span class="wb-chip">ESC CANCELS</span>'}
        </div>
        ${
          selected
            ? `<div class="wb-card wb-selected">
                <header class="wb-card-head"><span class="wb-index">SELECTED</span><b>${escapeHtml(selected.name || selected.id)}</b><span class="wb-chip">${escapeHtml(selected.id)}</span><span class="wb-chip">${regionBoundsLabel(selected)}</span><button class="btn btn-ghost" data-act="focus-region" data-id="${escapeHtml(selected.id)}">FRAME ON MAP</button></header>
                <p class="wb-note">Drag the highlighted rectangle on the map to move it, or drag one of its eight grips to resize. The numbers below stay authoritative and can be typed exactly.</p>
              </div>`
            : '<p class="wb-note">No region selected. Pick one below, or use DRAW ON MAP to create one.</p>'
        }
        ${doc.regions
          .map((region, index) => {
            const refs = regionReferences(doc, region.id);
            const overlaps = overlappingRegions(doc.regions, region, region.id);
            const isSelected = region.id === this.selectedRegionId;
            const outside =
              region.x < 0 ||
              region.z < 0 ||
              region.width < 1 ||
              region.height < 1 ||
              region.x + region.width > this.editor.scenario.width ||
              region.z + region.height > this.editor.scenario.height;
            return `<article class="wb-card region ${isSelected ? 'selected' : ''}" data-focus-key="region:${index}" data-region-card="${escapeHtml(region.id)}">
              <header class="wb-card-head">
                <b>${escapeHtml(region.name || region.id)}</b>
                <span class="wb-chip">${escapeHtml(region.id)}</span>
                <span class="wb-chip">${regionBoundsLabel(region)}</span>
                ${isSelected ? '<span class="wb-chip selected">SELECTED</span>' : ''}
                ${outside ? '<span class="wb-chip bad">OUTSIDE MAP</span>' : ''}
                ${overlaps.length ? `<span class="wb-chip warn">OVERLAPS ${overlaps.map((entry) => escapeHtml(entry.id)).join(', ')}</span>` : ''}
                ${refs.length === 0 ? '<span class="wb-chip warn">UNUSED</span>' : ''}
                <button class="btn btn-ghost" data-act="select-region" data-id="${escapeHtml(region.id)}">${isSelected ? 'SELECTED' : 'SELECT'}</button>
                <button class="btn btn-ghost" data-act="focus-region" data-id="${escapeHtml(region.id)}">LOCATE</button>
                <button class="btn btn-ghost" data-act="remove-region" data-index="${index}">REMOVE</button>
              </header>
              <div class="wb-grid four">
                ${field('ID', `<input data-scope="region" data-index="${index}" data-field="id" value="${escapeHtml(region.id)}" spellcheck="false">`, 'Stable reference. Triggers keep pointing at this id.')}
                ${field('Name', `<input data-scope="region" data-index="${index}" data-field="name" value="${escapeHtml(region.name ?? '')}">`)}
                ${field('X', `<input type="number" min="0" max="${this.editor.scenario.width - 1}" data-scope="region" data-index="${index}" data-field="x" value="${region.x}">`)}
                ${field('Z', `<input type="number" min="0" max="${this.editor.scenario.height - 1}" data-scope="region" data-index="${index}" data-field="z" value="${region.z}">`)}
                ${field('Width', `<input type="number" min="1" max="${this.editor.scenario.width}" data-scope="region" data-index="${index}" data-field="width" value="${region.width}">`)}
                ${field('Height', `<input type="number" min="1" max="${this.editor.scenario.height}" data-scope="region" data-index="${index}" data-field="height" value="${region.height}">`)}
                <div class="wb-inline"><span class="wb-chip">MAP ${this.editor.scenario.width}×${this.editor.scenario.height}</span><span class="wb-chip">${region.x + region.width - 1}, ${region.z + region.height - 1} LAST TILE</span></div>
              </div>
              ${refs.length ? `<p class="wb-note">Used at ${refs.map(escapeHtml).join(', ')}</p>` : '<p class="wb-note">Nothing reads this region yet. Add a region-occupancy condition in TRIGGERS to use it.</p>'}
            </article>`;
          })
          .join('') || '<p class="wb-note">No regions. Draw one on the map, or add a default rectangle to start from.</p>'}
        <div class="wb-actions">
          <button class="btn btn-ghost" data-act="add-region">ADD DEFAULT REGION</button>
        </div>
      </section>`;
  }

  /** Region card hit from the map selection, used by the overlay callback. */
  private selectRegion(id: string | null): void {
    this.selectedRegionId = id;
    this.editor.selectRegion(id);
    if (id) {
      const region = this.mission()?.regions.find((entry) => entry.id === id);
      if (region) this.editor.focusRegion(region.id);
    }
    this.render();
  }

  private triggers(): string {
    const doc = this.mission()!;
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-section-head">
          <div><h3>Mission triggers</h3><p>Every condition must hold at once. Priority decides order, not importance: a higher-priority trigger fires first within a tick.</p></div>
          <button class="btn btn-ghost" data-act="add-trigger">ADD TRIGGER</button>
        </div>
        <details class="wb-help">
          <summary>How triggers evaluate</summary>
          <ul>
            <li>All conditions are ANDed; an empty condition list is eligible immediately.</li>
            <li>Order is priority (high first), then trigger id — never document order.</li>
            <li>Actions run in the order authored inside the trigger.</li>
            <li>A cascade may execute at most 16 triggers per tick; the rest wait for the next tick.</li>
            <li>A delayed firing is cancelled if its conditions stop holding before the due tick.</li>
            <li><b>Once</b> fires a single time. <b>Repeat</b> re-arms only after its conditions go false.</li>
            <li><b>Cooldown</b> may repeat while its conditions stay true, but never faster than the cooldown.</li>
          </ul>
          <p>Nothing here claims to prove that a trigger is reachable in play; only a test run or a real mission can show that.</p>
        </details>
        ${doc.triggers
          .map((trigger, index) => this.triggerCard(doc, trigger, index))
          .join('') || '<p class="wb-note">No triggers. This mission has no authored way to complete its objectives.</p>'}
      </section>`;
  }

  private triggerCard(doc: MissionDoc, trigger: MissionTriggerDoc, index: number): string {
    return `<article class="wb-card trigger" data-focus-key="trigger:${index}">
      <header class="wb-card-head">
        <b>${escapeHtml(trigger.id)}</b>
        <span class="wb-chip">${triggerPolicyLabel(trigger)}</span>
        <span class="wb-chip">PRIORITY ${trigger.priority ?? 0}</span>
        <button class="btn btn-ghost" data-act="remove-trigger" data-index="${index}">REMOVE</button>
      </header>
      ${this.inlineIssues(`triggers[${index}]`)}
      <div class="wb-grid four">
        ${field('ID', `<input data-scope="trigger" data-index="${index}" data-field="id" value="${escapeHtml(trigger.id)}" spellcheck="false">`)}
        ${field('Priority', `<input type="number" step="1" data-scope="trigger" data-index="${index}" data-field="priority" value="${trigger.priority ?? 0}">`, 'Higher fires first.')}
        ${field('Delay seconds', `<input type="number" min="0" step="0.5" data-scope="trigger" data-index="${index}" data-field="delaySeconds" value="${trigger.delaySeconds ?? ''}" placeholder="none">`, 'Waits this long before acting, and cancels if the conditions stop holding.')}
        ${field('Cooldown seconds', `<input type="number" min="0" step="0.5" data-scope="trigger" data-index="${index}" data-field="cooldownSeconds" value="${trigger.cooldownSeconds ?? ''}" placeholder="none" ${trigger.once ? 'disabled' : ''}>`, trigger.once ? 'Repeat firing is off.' : 'Minimum time between firings.')}
      </div>
      <label class="wb-check"><input type="checkbox" data-scope="trigger" data-index="${index}" data-field="once" ${trigger.once ? 'checked' : ''}> Once only (repeat triggers must go false before re-arming; cooldown triggers may repeat while true).</label>
      <div class="wb-subhead"><span>CONDITIONS</span><button class="btn btn-ghost" data-act="add-condition" data-index="${index}">ADD CONDITION</button></div>
      <div class="wb-stack">${
        trigger.conditions
          .map((condition, ci) => this.conditionRow(doc, condition, index, ci))
          .join('') || '<p class="wb-note">No conditions. A trigger with no conditions is eligible immediately.</p>'
      }</div>
      <div class="wb-subhead"><span>ACTIONS</span><button class="btn btn-ghost" data-act="add-action" data-index="${index}">ADD ACTION</button></div>
      <div class="wb-stack">${
        trigger.actions
          .map((action, ai) => this.actionRow(doc, action, index, ai))
          .join('') || '<p class="wb-note">No actions.</p>'
      }</div>
    </article>`;
  }

  private conditionRow(doc: MissionDoc, condition: MissionCondition, ti: number, ci: number): string {
    const entities = authoredEntityKeys(this.editor.scenario);
    let fields = '';
    switch (condition.kind) {
      case 'elapsed':
        fields = field('Seconds', `<input type="number" min="0" step="0.1" data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="seconds" value="${condition.seconds}">`);
        break;
      case 'variable': {
        const variable = doc.variables.find((entry) => entry.id === condition.variable);
        fields = `<div class="wb-grid three">
          ${field('Variable', `<select data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="variable">${doc.variables.map((entry) => option(entry.id, `${entry.id} (${entry.type})`, condition.variable)).join('')}</select>`)}
          ${field('Comparison', `<select data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="op">${COMPARE_OPS.map((op) => option(op, op, condition.op)).join('')}</select>`)}
          ${field('Value', this.variableValueControl(variable?.type ?? 'string', condition.value, `data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="value"`))}
        </div>`;
        break;
      }
      case 'objective':
        fields = `<div class="wb-grid two">
          ${field('Objective', `<select data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="objective">${doc.objectives.map((entry) => option(entry.id, entry.title || entry.id, condition.objective)).join('')}</select>`)}
          ${field('State', `<select data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="state">${OBJECTIVE_STATES.map((state) => option(state, state, condition.state)).join('')}</select>`)}
        </div>`;
        break;
      case 'entityAlive':
      case 'entityDead': {
        const missing = Boolean(condition.entity) && !entities.includes(condition.entity);
        const options = `${!condition.entity ? '<option value="">Choose a placement…</option>' : ''}${missing ? `<option value="${escapeHtml(condition.entity)}" selected>${escapeHtml(condition.entity)} (not placed)</option>` : ''}${entities.map((key) => option(key, this.entityOptionLabel(key), condition.entity)).join('')}`;
        fields = this.entitySelectField(
          condition.entity,
          `<select data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="entity" aria-label="Authored placement">${options}</select>`,
          `data-act="pick-condition-entity" data-trigger="${ti}" data-index="${ci}"`,
          `data-act="clear-condition-entity" data-trigger="${ti}" data-index="${ci}"`,
        );
        break;
      }
      case 'regionOccupied': {
        const knownRegion = doc.regions.some((entry) => entry.id === condition.region);
        const regionOptions = `${!condition.region ? '<option value="">Choose a region…</option>' : ''}${!knownRegion && condition.region ? `<option value="${escapeHtml(condition.region)}" selected>${escapeHtml(condition.region)} (missing)</option>` : ''}${doc.regions.map((entry) => option(entry.id, `${entry.name || entry.id} · ${entry.width}×${entry.height}`, condition.region)).join('')}`;
        fields = `<div class="wb-grid three">
          ${field('Region', `<div class="wb-inline wb-ref-control"><select data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="region" aria-label="Region">${regionOptions}</select>${knownRegion ? `<button type="button" class="btn btn-ghost" data-act="focus-region" data-id="${escapeHtml(condition.region)}">LOCATE</button>` : ''}</div>`, knownRegion ? '' : 'No region with this id.')}
          ${field('Team', `<input type="number" min="0" max="7" data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="team" value="${condition.team}">`)}
          ${field('Tiles at least', `<input type="number" min="0" step="1" data-scope="condition" data-trigger="${ti}" data-index="${ci}" data-field="atLeast" value="${condition.atLeast}">`)}
        </div>`;
        break;
      }
    }
    return `<div class="wb-row condition">
      <div class="wb-row-head">
        <select data-scope="condition-kind" data-trigger="${ti}" data-index="${ci}">${CONDITION_KINDS.map((kind) => option(kind, conditionLabel(kind), condition.kind)).join('')}</select>
        <span class="wb-summary">${escapeHtml(describeCondition(condition))}</span>
        <span class="wb-row-actions"><button class="btn btn-ghost" data-act="condition-up" data-trigger="${ti}" data-index="${ci}" ${ci === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-ghost" data-act="condition-down" data-trigger="${ti}" data-index="${ci}">↓</button><button class="btn btn-ghost" data-act="remove-condition" data-trigger="${ti}" data-index="${ci}">REMOVE</button></span>
      </div>
      ${fields}
    </div>`;
  }

  private actionRow(doc: MissionDoc, action: MissionAction, ti: number, ai: number): string {
    let fields = '';
    switch (action.kind) {
      case 'setObjective':
        fields = `<div class="wb-grid two">
          ${field('Objective', `<select data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="objective">${doc.objectives.map((entry) => option(entry.id, entry.title || entry.id, action.objective)).join('')}</select>`)}
          ${field('State', `<select data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="state">${OBJECTIVE_STATES.map((state) => option(state, state, action.state)).join('')}</select>`)}
        </div>`;
        break;
      case 'setVariable': {
        const variable = doc.variables.find((entry) => entry.id === action.variable);
        fields = `<div class="wb-grid two">
          ${field('Variable', `<select data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="variable">${doc.variables.map((entry) => option(entry.id, `${entry.id} (${entry.type})`, action.variable)).join('')}</select>`)}
          ${field('Value', this.variableValueControl(variable?.type ?? 'string', action.value, `data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="value"`))}
        </div>`;
        break;
      }
      case 'message':
        fields = field('Message', `<input data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="text" value="${escapeHtml(action.text)}">`, 'A transient simulation notice. It never pauses the battle.');
        break;
      case 'activateAiGroup': {
        const group = doc.aiGroups.find((entry) => entry.id === action.group);
        fields = field(
          'AI group',
          `<select data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="group">${doc.aiGroups.map((entry) => option(entry.id, entry.initial === 'dormant' ? `${entry.id} (dormant)` : entry.id, action.group)).join('')}</select>`,
          group
            ? group.initial === 'dormant'
              ? 'Released once: its units leave their hold and attack the group region.'
              : 'This group already fights from the first tick; activating it again does nothing.'
            : 'Author an AI group before referencing it.',
        );
        break;
      }
      case 'spawnReinforcement': {
        const wave = doc.reinforcements.find((entry) => entry.id === action.reinforcement);
        fields = field(
          'Wave',
          `<select data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="reinforcement">${doc.reinforcements.map((entry) => option(entry.id, `${entry.id} (${entry.units.reduce((sum, unit) => sum + unit.count, 0)} units)`, action.reinforcement)).join('')}</select>`,
          wave
            ? 'Placed once, on the first free tiles of the wave region, then sent in.'
            : 'Author a reinforcement wave before referencing it.',
        );
        break;
      }
      case 'endMission':
        fields = field(
          'Outcome',
          `<select data-scope="action" data-trigger="${ti}" data-index="${ai}" data-field="outcome">${option('victory', 'Victory', action.outcome)}${option('defeat', 'Defeat', action.outcome)}</select>`,
          'Ends the battle through the ordinary result path. No later trigger runs.',
        );
        break;
    }
    return `<div class="wb-row action">
      <div class="wb-row-head">
        <select data-scope="action-kind" data-trigger="${ti}" data-index="${ai}">${ACTION_KINDS.map((kind) => option(kind, actionLabel(kind), action.kind)).join('')}</select>
        <span class="wb-summary">${escapeHtml(describeAction(action))}</span>
        <span class="wb-row-actions"><button class="btn btn-ghost" data-act="action-up" data-trigger="${ti}" data-index="${ai}" ${ai === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-ghost" data-act="action-down" data-trigger="${ti}" data-index="${ai}">↓</button><button class="btn btn-ghost" data-act="remove-action" data-trigger="${ti}" data-index="${ai}">REMOVE</button></span>
      </div>
      ${fields}
    </div>`;
  }

  private aiGroups(): string {
    const doc = this.mission()!;
    const keys = authoredEntityKeys(this.editor.scenario);
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-section-head">
          <div><h3>AI groups</h3><p>A group commands authored placements, not new units. A dormant group is placed on the map but held out of the fight until a trigger releases it once.</p></div>
          <button class="btn btn-ghost" data-act="add-ai-group">ADD GROUP</button>
        </div>
        <details class="wb-help">
          <summary>How a group behaves in play</summary>
          <ul>
            <li>Members are the stable keys of placements already in this scenario.</li>
            <li><b>Active</b> groups fight from the first tick; <b>dormant</b> groups stand where authored and the AI commander does not count them.</li>
            <li><b>Activate AI group</b> releases a dormant group once: it leaves its hold and attack-moves to the group region, then behaves like any AI command.</li>
            <li>A release is latched and saved, so leaving and reloading cannot task the group twice.</li>
            <li>The validator warns when a dormant group is never released, when its region does not exist, or when a member is not placed.</li>
          </ul>
        </details>
        ${doc.aiGroups
          .map((group, index) => {
            const missing = group.units.filter((key) => !keys.includes(key));
            const regionKnown = !group.region || doc.regions.some((entry) => entry.id === group.region);
            const dormant = (group.initial ?? 'active') === 'dormant';
            const released = doc.triggers.some((trigger) =>
              trigger.actions.some((action) => action.kind === 'activateAiGroup' && action.group === group.id),
            );
            return `<article class="wb-card" data-focus-key="aiGroup:${index}">
              <header class="wb-card-head">
                <b>${escapeHtml(group.id)}</b>
                <span class="wb-chip ${dormant ? 'warn' : 'ok'}">${dormant ? 'DORMANT' : 'ACTIVE'}</span>
                <span class="wb-chip">${escapeHtml(group.task.toUpperCase())}</span>
                <span class="wb-chip">${group.units.length} UNIT${group.units.length === 1 ? '' : 'S'} · OWNER ${group.owner}</span>
                ${group.region ? `<span class="wb-chip ${regionKnown ? '' : 'bad'}">${escapeHtml(group.region)}${regionKnown ? '' : ' · MISSING'}</span>` : '<span class="wb-chip warn">NO REGION</span>'}
                ${dormant && !released ? '<span class="wb-chip bad">NEVER RELEASED</span>' : ''}
                ${missing.length ? `<span class="wb-chip bad">${missing.length} NOT PLACED</span>` : ''}
                <button class="btn btn-ghost" data-act="remove-ai-group" data-index="${index}">REMOVE</button>
              </header>
              ${this.inlineIssues(`aiGroups[${index}]`)}
              <div class="wb-grid two">
                ${field('ID', `<input data-scope="ai-group" data-index="${index}" data-field="id" value="${escapeHtml(group.id)}" spellcheck="false">`, 'Trigger actions reference this id.')}
                ${field('Owner', `<input type="number" min="0" max="7" data-scope="ai-group" data-index="${index}" data-field="owner" value="${group.owner}">`, 'Team the members belong to.')}
                ${field('Task', `<select data-scope="ai-group" data-index="${index}" data-field="task">${AI_TASKS.map((task) => option(task, task, group.task)).join('')}</select>`)}
                ${field('Initial state', `<select data-scope="ai-group" data-index="${index}" data-field="initial">${option('active', 'Active from the first tick', group.initial ?? 'active')}${option('dormant', 'Dormant until released', group.initial ?? 'active')}</select>`, 'A dormant group must be released by an action or it never fights.')}
                ${field('Region', `<select data-scope="ai-group" data-index="${index}" data-field="region">${option('', 'No region — task default', group.region ?? '')}${doc.regions.map((entry) => option(entry.id, `${entry.name || entry.id} · ${entry.width}×${entry.height}`, group.region ?? '')).join('')}</select>`, 'Where the group goes after release.')}
              </div>
              <div class="wb-subhead"><span>MEMBERS</span><small>The placements this group commands.</small></div>
              <div class="wb-stack">${
                group.units
                  .map((key, unitIndex) => {
                    const info = describeEntityReference(this.editor.scenario, key);
                    return `<div class="wb-row">
                      <div class="wb-row-head">
                        <select data-scope="group-unit" data-index="${index}" data-unit="${unitIndex}" data-field="key" aria-label="Group member">${keys.map((candidate) => option(candidate, this.entityOptionLabel(candidate), key)).join('')}${info.found ? '' : `<option value="${escapeHtml(key)}" selected>${escapeHtml(key)} (not placed)</option>`}</select>
                        <span class="wb-summary">${escapeHtml(info.found ? info.detail : 'Not placed in this scenario')}</span>
                        <span class="wb-row-actions">
                          ${info.found ? `<button class="btn btn-ghost" data-act="focus-entity" data-key="${escapeHtml(key)}">LOCATE</button>` : ''}
                          <button class="btn btn-ghost" data-act="remove-group-unit" data-index="${index}" data-unit="${unitIndex}">REMOVE</button>
                        </span>
                      </div>
                    </div>`;
                  })
                  .join('') || '<p class="wb-note">No members. A group with no placed units commands nothing.</p>'
              }</div>
              ${
                keys.filter((key) => !group.units.includes(key)).length
                  ? `<div class="wb-inline wb-ref-add"><select data-scope="group-unit-add" data-index="${index}" aria-label="Add a member"><option value="">Add a placement…</option>${keys
                      .filter((key) => !group.units.includes(key))
                      .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(this.entityOptionLabel(key))}</option>`)
                      .join('')}</select></div>`
                  : '<p class="wb-note">Every keyed placement is already a member.</p>'
              }
              <p class="wb-note">${dormant ? (released ? 'Released by an authored action.' : 'Held until an action releases it. Add one in TRIGGERS.') : 'Fights from the first tick; activating it later does nothing.'}</p>
            </article>`;
          })
          .join('') || '<p class="wb-note">No AI groups. Add one to hold a reserve, stage an ambush or bring a counterattack in as a story beat.</p>'}
      </section>`;
  }

  private reinforcements(): string {
    const doc = this.mission()!;
    const defIds = Object.keys(UNITS).sort((a, b) => unitDefName(a).localeCompare(unitDefName(b)));
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-section-head">
          <div><h3>Reinforcement waves</h3><p>A wave is an ordinary roster force placed once on the free tiles of a region. It arrives from a <code>spawnReinforcement</code> action or on its own timer — never twice.</p></div>
          <button class="btn btn-ghost" data-act="add-reinforcement">ADD WAVE</button>
        </div>
        <details class="wb-help">
          <summary>How a wave behaves in play</summary>
          <ul>
            <li>Composition names real unit definitions; the units spawned are ordinary units with ordinary rules.</li>
            <li>Placement searches outward from the region centre for free, standable tiles, so a blocked entry cannot drop a column into a cliff.</li>
            <li>Arrival is latched and saved: a trigger that fires again, or a reload, cannot duplicate the wave.</li>
            <li>After placement the wave attack-moves into its region.</li>
            <li>The validator warns when a wave has neither a spawn action nor a timer, and when its region is missing.</li>
          </ul>
        </details>
        ${doc.reinforcements
          .map((wave, index) => {
            const total = wave.units.reduce((sum, unit) => sum + unit.count, 0);
            const regionKnown = doc.regions.some((entry) => entry.id === wave.region);
            const requestedBy = doc.triggers
              .filter((trigger) =>
                trigger.actions.some(
                  (action) => action.kind === 'spawnReinforcement' && action.reinforcement === wave.id,
                ),
              )
              .map((trigger) => trigger.id);
            const scheduled = requestedBy.length > 0 || wave.afterSeconds !== undefined;
            const triggerKnown = !wave.triggerId || doc.triggers.some((entry) => entry.id === wave.triggerId);
            return `<article class="wb-card" data-focus-key="reinforcement:${index}">
              <header class="wb-card-head">
                <b>${escapeHtml(wave.id)}</b>
                <span class="wb-chip">${total} UNIT${total === 1 ? '' : 'S'} · OWNER ${wave.owner}</span>
                <span class="wb-chip ${regionKnown ? '' : 'bad'}">${escapeHtml(wave.region || 'NO REGION')}${wave.region && !regionKnown ? ' · MISSING' : ''}</span>
                <span class="wb-chip ${scheduled ? 'ok' : 'bad'}">${scheduled ? (requestedBy.length ? `ON ACTION ${requestedBy.join(', ')}` : `AT ${wave.afterSeconds}s`) : 'NEVER ARRIVES'}</span>
                <button class="btn btn-ghost" data-act="remove-reinforcement" data-index="${index}">REMOVE</button>
              </header>
              ${this.inlineIssues(`reinforcements[${index}]`)}
              <div class="wb-grid four">
                ${field('ID', `<input data-scope="reinforcement" data-index="${index}" data-field="id" value="${escapeHtml(wave.id)}" spellcheck="false">`, 'Trigger actions reference this id.')}
                ${field('Owner', `<input type="number" min="0" max="7" data-scope="reinforcement" data-index="${index}" data-field="owner" value="${wave.owner}">`)}
                ${field('Region', `<select data-scope="reinforcement" data-index="${index}" data-field="region">${!wave.region ? '<option value="">Choose a region…</option>' : ''}${wave.region && !regionKnown ? `<option value="${escapeHtml(wave.region)}" selected>${escapeHtml(wave.region)} (missing)</option>` : ''}${doc.regions.map((entry) => option(entry.id, `${entry.name || entry.id} · ${entry.width}×${entry.height}`, wave.region)).join('')}</select>`, regionKnown ? 'The wave arrives on this region’s free tiles.' : 'No region with this id.')}
                ${field('After seconds', `<input type="number" min="0" step="0.5" data-scope="reinforcement" data-index="${index}" data-field="afterSeconds" value="${wave.afterSeconds ?? ''}" placeholder="trigger only">`, 'Leave blank when a trigger brings the wave in.')}
              </div>
              ${field('Requesting trigger', `<select data-scope="reinforcement" data-index="${index}" data-field="triggerId">${option('', 'None', wave.triggerId ?? '')}${!triggerKnown && wave.triggerId ? `<option value="${escapeHtml(wave.triggerId)}" selected>${escapeHtml(wave.triggerId)} (missing)</option>` : ''}${doc.triggers.map((entry) => option(entry.id, entry.id, wave.triggerId ?? '')).join('')}</select>`, 'A reference for authors and readers; arrival is decided by the action or the timer.')}
              <div class="wb-subhead"><span>COMPOSITION</span><small>Unit definitions and counts.</small></div>
              <div class="wb-stack">${
                wave.units
                  .map(
                    (unit, unitIndex) => `<div class="wb-row">
                      <div class="wb-row-head">
                        <select data-scope="wave-unit" data-index="${index}" data-unit="${unitIndex}" data-field="defId" aria-label="Unit definition">${defIds.map((defId) => option(defId, unitDefName(defId), unit.defId)).join('')}</select>
                        <input type="number" min="1" max="64" data-scope="wave-unit" data-index="${index}" data-unit="${unitIndex}" data-field="count" value="${unit.count}" aria-label="Count">
                        <span class="wb-row-actions"><button class="btn btn-ghost" data-act="remove-wave-unit" data-index="${index}" data-unit="${unitIndex}">REMOVE</button></span>
                      </div>
                    </div>`,
                  )
                  .join('') || '<p class="wb-note">No composition. A wave with no units arrives empty.</p>'
              }</div>
              <div class="wb-inline wb-ref-add"><select data-scope="wave-unit-add" data-index="${index}" aria-label="Add a unit type"><option value="">Add a unit type…</option>${defIds.map((defId) => `<option value="${escapeHtml(defId)}">${escapeHtml(unitDefName(defId))}</option>`).join('')}</select></div>
            </article>`;
          })
          .join('') || '<p class="wb-note">No reinforcement waves. Add one to bring a column in when the mission calls for it.</p>'}
      </section>`;
  }

  private cinematics(): string {
    const doc = this.mission()!;
    const counts = new Map<string, number>();
    doc.cinematics.forEach((cinematic) =>
      counts.set(cinematic.kind, (counts.get(cinematic.kind) ?? 0) + 1),
    );
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-section-head">
          <div><h3>Cinematic timelines</h3><p>The runtime plays the first authored sequence of each context. A second opening/intermission/ending is validated with a warning and ignored; an in-mission sequence also needs a time gate.</p></div>
          <button class="btn btn-ghost" data-act="add-cinematic">ADD SEQUENCE</button>
        </div>
        ${doc.cinematics
          .map((cinematic, index) => {
            const duplicate = (counts.get(cinematic.kind) ?? 0) > 1;
            const hasCamera = cinematic.steps.some((step) => step.kind === 'camera');
            return `<article class="wb-card cinematic" data-focus-key="cinematic:${index}">
              <header class="wb-card-head">
                <b>${escapeHtml(cinematic.id)}</b>
                <span class="wb-chip">${cinematic.kind.toUpperCase()}</span>
                <span class="wb-chip">${cinematic.steps.length} STEPS</span>
                ${duplicate ? '<span class="wb-chip bad">DUPLICATE CONTEXT · ONLY FIRST PLAYS</span>' : ''}
                <button class="btn btn-ghost" data-act="preview-cinematic" data-index="${index}" ${hasCamera ? '' : 'disabled'}>PREVIEW</button>
                <button class="btn btn-ghost" data-act="remove-cinematic" data-index="${index}">REMOVE</button>
              </header>
              <div class="wb-grid four">
                ${field('ID', `<input data-scope="cinematic" data-index="${index}" data-field="id" value="${escapeHtml(cinematic.id)}" spellcheck="false">`)}
                ${field('Context', `<select data-scope="cinematic" data-index="${index}" data-field="kind">${CINEMATIC_KINDS.map((kind) => option(kind, kind, cinematic.kind)).join('')}</select>`)}
                ${field('At mission second', `<input type="number" min="0" step="0.5" data-scope="cinematic" data-index="${index}" data-field="atSeconds" value="${cinematic.atSeconds ?? ''}" placeholder="${cinematic.kind === 'inMission' ? 'required' : 'n/a'}" ${cinematic.kind === 'inMission' ? '' : 'disabled'}>`)}
                <label class="wb-check"><input type="checkbox" data-scope="cinematic" data-index="${index}" data-field="skippable" ${cinematic.skippable ? 'checked' : ''}> Skippable</label>
              </div>
              <div class="wb-subhead"><span>ORDERED TIMELINE</span><button class="btn btn-ghost" data-act="add-step" data-index="${index}" data-kind="line">ADD LINE</button><button class="btn btn-ghost" data-act="add-step" data-index="${index}" data-kind="camera">ADD CAMERA</button><button class="btn btn-ghost" data-act="add-step" data-index="${index}" data-kind="notify">ADD NOTICE</button></div>
              <div class="wb-stack">${
                cinematic.steps
                  .map((step, si) => this.stepRow(cinematic, index, step, si))
                  .join('') || '<p class="wb-note">No timeline steps. This sequence will be rejected by validation.</p>'
              }</div>
            </article>`;
          })
          .join('') || '<p class="wb-note">No cinematics. The mission opens directly into gameplay.</p>'}
      </section>`;
  }

  private stepRow(
    cinematic: MissionCinematicDoc,
    ci: number,
    step: MissionCinematicStep,
    si: number,
  ): string {
    const common = `data-index="${ci}" data-step="${si}"`;
    const reorder = `<button class="btn btn-ghost" data-act="step-up" ${common} ${si === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-ghost" data-act="step-down" ${common} ${si === cinematic.steps.length - 1 ? 'disabled' : ''}>↓</button><button class="btn btn-ghost" data-act="remove-step" ${common}>REMOVE</button>`;
    if (step.kind === 'camera') {
      const entityTarget = step.target.kind === 'entity' ? step.target : null;
      const positionTarget = step.target.kind === 'position' ? step.target : null;
      return `<div class="wb-row step">
        <div class="wb-row-head"><span class="wb-chip">${String(si + 1).padStart(2, '0')} CAMERA</span><span class="wb-summary">${entityTarget ? `focus ${escapeHtml(entityTarget.entity)}` : `map ${Math.round(positionTarget?.x ?? 0)}, ${Math.round(positionTarget?.z ?? 0)}`} · ${step.durationSeconds}s move${step.holdSeconds ? ` · ${step.holdSeconds}s hold` : ''}</span><span class="wb-row-actions">${reorder}</span></div>
        <div class="wb-grid four">
          ${field('Target', `<select data-scope="step-target-kind" data-index="${ci}" data-step="${si}">${option('entity', 'Entity', step.target.kind)}${option('position', 'Map position', step.target.kind)}</select>`)}
          ${
            entityTarget
              ? this.entitySelectField(
                  entityTarget.entity,
                  `<select data-scope="step-target-entity" data-index="${ci}" data-step="${si}" aria-label="Camera focus entity">${authoredEntityKeys(this.editor.scenario).includes(entityTarget.entity) ? '' : `<option value="${escapeHtml(entityTarget.entity)}" selected>${escapeHtml(entityTarget.entity)} (not placed)</option>`}${authoredEntityKeys(this.editor.scenario).map((key) => option(key, this.entityOptionLabel(key), entityTarget.entity)).join('')}</select>`,
                  `data-act="pick-cinematic-entity" data-index="${ci}" data-step="${si}"`,
                  `data-act="clear-cinematic-entity" data-index="${ci}" data-step="${si}"`,
                  'Camera focus',
                )
              : `${field('X', `<input type="number" step="0.5" data-scope="step-target-x" data-index="${ci}" data-step="${si}" value="${positionTarget?.x ?? 0}">`)}${field('Z', `<input type="number" step="0.5" data-scope="step-target-z" data-index="${ci}" data-step="${si}" value="${positionTarget?.z ?? 0}">`)}`
          }
          ${field('Zoom', `<input type="number" min="1" max="110" step="1" data-scope="step" data-index="${ci}" data-step="${si}" data-field="zoom" value="${step.zoom ?? ''}" placeholder="current">`)}
        </div>
        <div class="wb-grid three">
          ${field('Move seconds', `<input type="number" min="0" step="0.1" data-scope="step" data-index="${ci}" data-step="${si}" data-field="durationSeconds" value="${step.durationSeconds}">`)}
          ${field('Hold seconds', `<input type="number" min="0" step="0.1" data-scope="step" data-index="${ci}" data-step="${si}" data-field="holdSeconds" value="${step.holdSeconds ?? 0}">`)}
        </div>
      </div>`;
    }
    if (step.kind === 'line') {
      return `<div class="wb-row step">
        <div class="wb-row-head"><span class="wb-chip">${String(si + 1).padStart(2, '0')} LINE</span><span class="wb-summary">${escapeHtml(step.speaker)}: ${escapeHtml(step.text)}</span><span class="wb-row-actions">${reorder}</span></div>
        <div class="wb-grid two">
          ${field('Speaker', `<input data-scope="step" data-index="${ci}" data-step="${si}" data-field="speaker" value="${escapeHtml(step.speaker)}">`)}
          ${field('Text', `<input data-scope="step" data-index="${ci}" data-step="${si}" data-field="text" value="${escapeHtml(step.text)}">`)}
          ${field('Subtitle seconds', `<input type="number" min="0.1" step="0.1" data-scope="step" data-index="${ci}" data-step="${si}" data-field="durationSeconds" value="${step.durationSeconds}">`)}
          ${field('Silent pause', `<input type="number" min="0" step="0.1" data-scope="step" data-index="${ci}" data-step="${si}" data-field="pauseSeconds" value="${step.pauseSeconds ?? 0}">`)}
        </div>
      </div>`;
    }
    return `<div class="wb-row step">
      <div class="wb-row-head"><span class="wb-chip">${String(si + 1).padStart(2, '0')} NOTICE</span><span class="wb-summary">${escapeHtml(step.text)}</span><span class="wb-row-actions">${reorder}</span></div>
      <div class="wb-grid two">
        ${field('Text', `<input data-scope="step" data-index="${ci}" data-step="${si}" data-field="text" value="${escapeHtml(step.text)}">`)}
        ${field('Duration', `<input type="number" min="0.1" step="0.1" data-scope="step" data-index="${ci}" data-step="${si}" data-field="durationSeconds" value="${step.durationSeconds ?? 3}">`)}
      </div>
    </div>`;
  }

  private missionIssues() {
    const doc = this.mission();
    if (!doc) return [];
    return this.validate(doc);
  }

  /** Validation findings that belong to one authored trigger, shown inline. */
  private inlineIssues(prefix: string): string {
    const issues = this.missionIssues().filter((issue) => issue.path.startsWith(prefix));
    if (issues.length === 0) return '';
    return `<div class="wb-inline-issues">${issues
      .map(
        (issue) =>
          `<p class="wb-inline-issue ${issue.severity}"><b>${issue.severity === 'error' ? 'ERR' : issue.severity === 'warning' ? 'WARN' : 'INFO'}</b> ${escapeHtml(issue.message)} <small>${escapeHtml(issue.path)}</small></p>`,
      )
      .join('')}</div>`;
  }

  /**
   * The authoring diagnostic set: mission document plus the scenario placements
   * it references. One canonical read, so the header badge, the inline rows and
   * the validation panel can never disagree.
   */
  private validate(doc: MissionDoc) {
    return authoringIssues(doc, this.editor.scenario);
  }

  private validation(): string {
    const doc = this.mission()!;
    const issues = this.validate(doc);
    const errors = issues.filter((issue) => issue.severity === 'error');
    const warnings = issues.filter((issue) => issue.severity === 'warning');
    const info = issues.filter((issue) => issue.severity === 'info');
    const render = (list: typeof issues, empty: string) =>
      list.length === 0
        ? `<p class="wb-note">${empty}</p>`
        : list
            .map(
              (issue) =>
                `<button class="issue ${issue.severity}" data-act="goto" data-section="${sectionForPath(issue.path)}" data-path="${escapeHtml(issue.path)}" title="Open ${escapeHtml(issue.path)}"><span class="sev">${issue.severity === 'error' ? 'ERR' : issue.severity === 'warning' ? 'WARN' : 'INFO'}</span><span><p>${escapeHtml(issue.message)}</p><small>${escapeHtml(issue.path)} · ${escapeHtml(issue.code)}</small></span><span class="issue-go">OPEN ›</span></button>`,
            )
            .join('');
    return `
      <section class="wb-section">
        ${this.toolbar()}
        <div class="wb-summary-strip">
          <div class="${errors.length ? 'bad' : 'ok'}"><span>ERRORS</span><b>${errors.length}</b><small>${errors.length ? 'Block test launch and library save' : 'Document can launch'}</small></div>
          <div class="${warnings.length ? 'warn' : 'ok'}"><span>WARNINGS</span><b>${warnings.length}</b><small>Launch allowed; review the design</small></div>
          <div><span>INFO</span><b>${info.length}</b><small>Authored context</small></div>
          <div><span>AUTHORED</span><b>${doc.objectives.length}</b><small>${doc.triggers.length} trigger${doc.triggers.length === 1 ? '' : 's'} · ${doc.cinematics.length} scene${doc.cinematics.length === 1 ? '' : 's'}</small></div>
        </div>
        <div class="wb-card"><h3>Errors</h3>${render(errors, 'No blocking errors.')}</div>
        <div class="wb-card"><h3>Warnings</h3>${render(warnings, 'No warnings.')}</div>
        <div class="wb-card"><h3>Information</h3>${render(info, 'No informational findings.')}</div>
        <div class="wb-card">
          <h3>Test launch</h3>
          <p>The test uses the real mission runtime: objective state, S3 triggers, S5 opening cinematics, the real result and the real debrief. Campaign metadata is stripped from the test copy, so no progression, consequence or veteran change can be committed. The workbench reopens when you return.</p>
          <button class="btn btn-primary" data-act="test" ${errors.length ? 'disabled' : ''}>${errors.length ? `FIX ${errors.length} ERROR${errors.length === 1 ? '' : 'S'} TO TEST` : 'TEST OPERATION'}</button>
        </div>
        <div class="wb-card">
          <h3>Validation scope</h3>
          <p class="wb-note">Structural and reference checks run against the enclosing scenario: ids, dependencies, cycles, regions, variables, placements, camera targets and duplicate keys. Each finding opens the section and item that owns it, and highlights the map object where one exists.</p>
          <p class="wb-note">These checks do not prove gameplay reachability, AI competence, force sufficiency or balance — those need a test run or a person playing the mission. A warning never blocks the test launch; only errors do.</p>
        </div>
      </section>`;
  }

  /**
   * Recovery points and storage state.
   *
   * Three versions exist and none of them is authoritative for the others: the
   * browser draft (latest edit, valid or not), the saved library copy and the
   * last snapshot that validated. The panel states which is which and what a
   * restore will replace.
   */
  private recovery(): string {
    const health = libraryHealth(this.storage, { probe: true });
    const draft = this.editor.draftState();
    const entry = this.entries().find((item) => item.id === this.entryId);
    const records = health.recoveries;
    const draftAt = draft.meta ? new Date(draft.meta.savedAt).toLocaleString() : null;
    const savedAt = entry ? new Date(entry.updatedAt).toLocaleString() : null;
    const validAt = entry?.lastValidAt ? new Date(entry.lastValidAt).toLocaleString() : null;
    const snapshotAvailable = canRestoreLastValid(entry);
    const draftDiffers = Boolean(
      draft.scenario && scenarioToJson(draft.scenario) !== scenarioToJson(this.editor.scenario),
    );
    return `
      <section class="wb-section">
        <div class="wb-summary-strip">
          <div class="${draft.scenario ? 'ok' : 'warn'}"><span>BROWSER DRAFT</span><b>${draftAt ?? 'NONE'}</b><small>${draft.meta ? `${draft.meta.errorCount} ERR · ${draft.meta.warningCount} WARN` : 'written shortly after each edit'}</small></div>
          <div class="${entry ? 'ok' : 'warn'}"><span>SAVED COPY</span><b>${savedAt ?? 'NOT IN LIBRARY'}</b><small>${entry ? `library ${escapeHtml(entry.id)}` : 'save to create one'}</small></div>
          <div class="${snapshotAvailable ? 'warn' : 'ok'}"><span>LAST VALID</span><b>${validAt ?? 'NONE'}</b><small>${snapshotAvailable ? 'older snapshot available' : 'no older validated snapshot'}</small></div>
          <div class="${health.status === 'ok' ? 'ok' : 'bad'}"><span>${health.label}</span><b>${formatByteSize(health.bytes)}</b><small>${escapeHtml(health.detail)}</small></div>
        </div>

        <div class="wb-card">
          <h3>Recovery points</h3>
          <div class="wb-recovery-row">
            <div>
              <b>Browser draft</b>
              <small>${draftAt ? `saved ${escapeHtml(draftAt)}` : 'nothing stored'}${draft.present && !draft.scenario ? ' · unreadable' : ''}</small>
              <p>${draftDiffers ? 'Differs from the document open now.' : draft.scenario ? 'Matches the document open now.' : 'Written about two seconds after each edit, whether or not the document validates.'}</p>
            </div>
            <div class="wb-row-actions">
              <button class="btn btn-ghost" data-act="restore-draft" ${draft.scenario ? '' : 'disabled'}>RESTORE DRAFT</button>
              <button class="btn btn-ghost" data-act="export-draft" ${draft.scenario ? '' : 'disabled'}>EXPORT DRAFT</button>
            </div>
          </div>
          <div class="wb-recovery-row">
            <div>
              <b>Saved library copy</b>
              <small>${savedAt ? escapeHtml(savedAt) : 'not stored yet'}</small>
              <p>What the library holds now. Reverting replaces the open mission and clears the unsaved-edits marker.</p>
            </div>
            <div class="wb-row-actions">
              <button class="btn btn-ghost" data-act="revert" ${entry ? '' : 'disabled'}>REVERT TO SAVED</button>
              <button class="btn btn-ghost" data-act="export-current">EXPORT CURRENT</button>
            </div>
          </div>
          <div class="wb-recovery-row">
            <div>
              <b>Last validated snapshot</b>
              <small>${validAt ? escapeHtml(validAt) : 'none recorded'}</small>
              <p>${snapshotAvailable ? 'An older document that validated cleanly. Restoring it leaves the result unsaved until you save again.' : 'Only created once a different document has been saved, so the saved copy is currently the only version.'}</p>
            </div>
            <div class="wb-row-actions">
              <button class="btn btn-ghost" data-act="restore-valid" ${snapshotAvailable ? '' : 'disabled'}>RESTORE LAST VALID</button>
            </div>
          </div>
        </div>

        <div class="wb-card">
          <h3>Preserved records</h3>
          ${
            records.length === 0
              ? '<p class="wb-note">Nothing is quarantined. Damaged or unreadable records would be listed here with their original text, and are never deleted automatically.</p>'
              : `<p class="wb-note">These payloads could not be read as documents. Their original text is preserved byte for byte; exporting one does not change the library.</p>${records
                  .map((record) => {
                    const described = describeRecovery(record);
                    return `<div class="wb-recovery-row" data-rec="${escapeHtml(record.id)}">
                      <div>
                        <b>${escapeHtml(described.label)}</b>
                        <small>${escapeHtml(described.detail)} · ${escapeHtml(new Date(record.capturedAt).toLocaleString())}</small>
                        <p>${escapeHtml(record.reason)}</p>
                      </div>
                      <div class="wb-row-actions">
                        <button class="btn btn-ghost" data-act="recovery-export" data-rec="${escapeHtml(record.id)}">EXPORT RAW</button>
                        <button class="btn btn-ghost" data-act="recovery-recover" data-rec="${escapeHtml(record.id)}">RECOVER AS COPY</button>
                      </div>
                    </div>`;
                  })
                  .join('')}`
          }
        </div>

        <div class="wb-card">
          <h3>Storage</h3>
          <p class="wb-note">The library keeps authored documents and their recovery copies in browser storage, separate from battle saves, campaign progress and presentation settings. ${formatByteSize(health.bytes)} is currently held here. Browsers apply their own quota, so this figure estimates usage rather than a fixed limit. Nothing is deleted or compressed automatically to make room.</p>
          <ul class="wb-note-list">
            <li>Envelope format ${!health.envelope.version ? 'legacy (unversioned)' : `v${health.envelope.version}`}${health.envelope.migratedFrom !== null ? ` · read as v${health.envelope.migratedFrom} and migrated` : ''}</li>
            <li>${health.entries} stored document${health.entries === 1 ? '' : 's'} · ${health.unreadable} unreadable record${health.unreadable === 1 ? '' : 's'}</li>
            <li>${health.canWrite ? 'Writes are available.' : 'Writes are currently blocked; export anything you need to keep.'}</li>
          </ul>
        </div>
      </section>`;
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  private onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const section = target?.closest<HTMLElement>('[data-section]');
    if (section && !target?.closest('[data-act="goto"]')) {
      const id = section.dataset.section as MissionSection | undefined;
      if (id && SECTIONS.some((entry) => entry.id === id)) {
        this.showSection(id);
      }
      return;
    }
    const button = target?.closest<HTMLElement>('[data-act]');
    if (!button) return;
    const act = button.dataset.act ?? '';
    const index = Number(button.dataset.index ?? 0);
    if (act === 'goto') {
      const path = button.dataset.path;
      if (path) {
        this.jumpTo(path);
        return;
      }
      const id = button.dataset.section as MissionSection | undefined;
      if (id) this.showSection(id);
      return;
    }
    if (act === 'goto-objective') {
      this.section = 'objectives';
      this.focusKey = `objective:${index}`;
      this.render();
      return;
    }
    if (act === 'region-draw' || act === 'region-select') {
      const wanted = act === 'region-draw' ? 'draw' : 'select';
      this.editor.setRegionTool(this.editor.regionTool === wanted ? 'off' : wanted);
      this.showRegions = true;
      this.editor.showRegions = true;
      this.render();
      return;
    }
    if (act === 'region-tool-off') {
      this.editor.setRegionTool('off');
      this.render();
      return;
    }
    if (act === 'select-region') {
      this.selectRegion(button.dataset.id ?? null);
      return;
    }
    if (act === 'focus-region') {
      const id = button.dataset.id ?? this.selectedRegionId;
      if (!id) return;
      this.selectedRegionId = id;
      this.showRegions = true;
      this.editor.showRegions = true;
      this.editor.selectRegion(id);
      this.editor.focusRegion(id);
      this.render();
      return;
    }
    if (act === 'focus-entity') {
      const key = button.dataset.key ?? '';
      if (!key) return;
      this.highlightKey = key;
      this.editor.setEntityHighlight(key);
      this.editor.focusEntity(key);
      this.render();
      return;
    }
    if (act === 'pick-objective-entity') {
      const objective = this.mission()?.objectives[index];
      if (!objective) return;
      const slot = button.dataset.value ?? null;
      this.beginEntityPick((picked) => {
        const current = objective.protectedEntities ?? [];
        objective.protectedEntities =
          slot && current.includes(slot)
            ? current.map((entry) => (entry === slot ? picked : entry))
            : [...new Set([...current, picked])];
      });
      return;
    }
    if (act === 'remove-protected-entity') {
      const objective = this.mission()?.objectives[index];
      const key = button.dataset.value ?? '';
      if (!objective || !key) return;
      objective.protectedEntities = (objective.protectedEntities ?? []).filter((entry) => entry !== key);
      this.commit();
      return;
    }
    if (act === 'pick-condition-entity') {
      const trigger = this.mission()?.triggers[Number(button.dataset.trigger ?? 0)];
      const condition = trigger?.conditions[Number(button.dataset.index ?? 0)];
      if (!condition || (condition.kind !== 'entityAlive' && condition.kind !== 'entityDead')) return;
      this.beginEntityPick((picked) => {
        condition.entity = picked;
      });
      return;
    }
    if (act === 'clear-condition-entity') {
      const trigger = this.mission()?.triggers[Number(button.dataset.trigger ?? 0)];
      const condition = trigger?.conditions[Number(button.dataset.index ?? 0)];
      if (!condition || (condition.kind !== 'entityAlive' && condition.kind !== 'entityDead')) return;
      // Clearing leaves an explicitly unset reference, which validation reports.
      // Picking a different placement on the author's behalf would change the
      // meaning of the mission without a decision.
      condition.entity = '';
      this.commit();
      return;
    }
    if (act === 'pick-cinematic-entity') {
      const cinematic = this.mission()?.cinematics[index];
      const step = cinematic?.steps[Number(button.dataset.step ?? 0)];
      if (!step || step.kind !== 'camera') return;
      this.beginEntityPick((picked) => {
        step.target = { kind: 'entity', entity: picked };
      });
      return;
    }
    if (act === 'clear-cinematic-entity') {
      const cinematic = this.mission()?.cinematics[index];
      const step = cinematic?.steps[Number(button.dataset.step ?? 0)];
      if (!step || step.kind !== 'camera') return;
      step.target = {
        kind: 'position',
        x: this.editor.scenario.width / 2,
        z: this.editor.scenario.height / 2,
      };
      this.commit();
      return;
    }
    if (act === 'key-placements') {
      const added = materialiseEntityKeys(this.editor.scenario);
      this.app.notify(
        added.length ? `Added ${added.length} authored key${added.length === 1 ? '' : 's'}: ${added.join(', ')}` : 'Every placement already has a key.',
        added.length ? 'success' : 'info',
      );
      if (added.length) this.commit();
      else this.render();
      return;
    }
    if (act === 'close') {
      this.close();
      return;
    }
    if (act === 'library') {
      this.editor.openMissionLibrary();
      return;
    }
    if (act === 'create-mission') {
      const created = ensureMissionForScenario(this.editor.scenario, {
        id: nextMissionIdForScenario(this.editor.scenario, this.entries()),
      });
      this.editor.missionChanged();
      this.app.notify(
        created.keysAdded.length
          ? `Mission draft created. Added authored keys: ${created.keysAdded.join(', ')}.`
          : 'Mission draft created.',
        'success',
      );
      this.entryId = null;
      this.dirty = true;
      this.render();
      return;
    }
    if (act === 'save') {
      this.save();
      return;
    }
    if (act === 'save-copy') {
      this.saveCopy();
      return;
    }
    if (act === 'export-mission') {
      this.exportMissionOnly();
      return;
    }
    if (act === 'export-scenario' || act === 'export-current') {
      this.exportScenarioDocument();
      return;
    }
    if (act === 'export-draft') {
      const draft = this.editor.draftState();
      if (!draft.scenario) {
        this.app.notify('No readable browser draft is stored.', 'warning');
        return;
      }
      const name = draft.scenario.mission?.title ?? draft.scenario.meta.name;
      downloadJson(libraryFilename(name, 'draft'), draftExportJson(draft.scenario));
      this.app.notify('Browser draft downloaded.', 'success');
      return;
    }
    if (act === 'restore-draft') {
      this.restoreDraft();
      return;
    }
    if (act === 'recovery-export' || act === 'recovery-recover') {
      const id = button.dataset.rec;
      const record = id
        ? readLibraryRecoveries(this.storage).records.find((item) => item.id === id)
        : undefined;
      if (!record) {
        this.app.notify('That preserved record is no longer available.', 'warning');
        return;
      }
      if (act === 'recovery-export') {
        downloadJson(recoveryFilename(record), record.raw);
        this.app.notify('Preserved record downloaded exactly as captured.', 'success');
        return;
      }
      this.confirmRemove(
        'Recover this record as a new detached library copy? No existing document is replaced, and the recovered copy is detached from any campaign.',
        () => {
          try {
            const entry = recoverLibraryRecord(this.storage, record, { host: this.editor.scenario });
            this.app.notify(`Recovered as "${entry.title}".`, 'success');
            this.render();
          } catch (error) {
            this.app.notify(
              `Recovery failed: ${error instanceof Error ? error.message : String(error)}`,
              'critical',
            );
          }
        },
        'Recover record',
      );
      return;
    }
    if (act === 'copy-mission') {
      const mission = this.mission();
      if (!mission) return;
      void copyText(missionJson(mission)).then((ok) =>
        this.app.notify(ok ? 'Mission JSON copied.' : 'Clipboard is unavailable in this browser.', ok ? 'success' : 'warning'),
      );
      return;
    }
    if (act === 'import') {
      this.importFile();
      return;
    }
    if (act === 'restore-valid') {
      this.restoreLastValid();
      return;
    }
    if (act === 'revert') {
      this.revertToSaved();
      return;
    }
    if (act === 'test') {
      if (this.validate(this.mission()!).some((issue) => issue.severity === 'error')) return;
      this.editor.testLaunchMission();
      return;
    }
    if (act === 'toggle-regions') {
      this.showRegions = !this.showRegions;
      this.editor.showRegions = this.showRegions;
      this.render();
      return;
    }
    if (act === 'add-objective') {
      this.addObjective();
      return;
    }
    if (act === 'remove-objective') {
      this.removeObjective(index);
      return;
    }
    if (act === 'add-variable') {
      this.addVariable();
      return;
    }
    if (act === 'remove-variable') {
      this.removeVariable(index);
      return;
    }
    if (act === 'add-region') {
      this.addRegion();
      return;
    }
    if (act === 'remove-region') {
      this.removeRegion(index);
      return;
    }
    if (act === 'add-ai-group') {
      this.addAiGroup();
      return;
    }
    if (act === 'remove-ai-group') {
      this.removeAiGroup(index);
      return;
    }
    if (act === 'remove-group-unit') {
      this.removeGroupUnit(index, Number(button.dataset.unit ?? 0));
      return;
    }
    if (act === 'add-reinforcement') {
      this.addReinforcement();
      return;
    }
    if (act === 'remove-reinforcement') {
      this.removeReinforcement(index);
      return;
    }
    if (act === 'remove-wave-unit') {
      this.removeWaveUnit(index, Number(button.dataset.unit ?? 0));
      return;
    }
    if (act === 'add-trigger') {
      this.addTrigger();
      return;
    }
    if (act === 'remove-trigger') {
      const trigger = this.mission()!.triggers[index];
      if (trigger) this.confirmRemove(`Remove trigger "${trigger.id}"?`, () => {
        this.mission()!.triggers.splice(index, 1);
        this.commit();
      });
      return;
    }
    if (act === 'add-condition') {
      this.addCondition(index);
      return;
    }
    if (act === 'remove-condition' || act === 'condition-up' || act === 'condition-down') {
      const ti = Number(button.dataset.trigger ?? 0);
      this.moveAuthoredItem(ti, 'conditions', Number(button.dataset.index ?? 0), act);
      return;
    }
    if (act === 'add-action') {
      this.addAction(index);
      return;
    }
    if (act === 'remove-action' || act === 'action-up' || act === 'action-down') {
      const ti = Number(button.dataset.trigger ?? 0);
      this.moveAuthoredItem(ti, 'actions', Number(button.dataset.index ?? 0), act);
      return;
    }
    if (act === 'add-brief-list' || act === 'remove-brief-list') {
      this.briefList(act, button.dataset.list === 'instructions' ? 'instructions' : 'personnel', index);
      return;
    }
    if (act === 'add-cinematic') {
      this.addCinematic();
      return;
    }
    if (act === 'remove-cinematic') {
      const cinematic = this.mission()!.cinematics[index];
      if (cinematic) this.confirmRemove(`Remove cinematic "${cinematic.id}"?`, () => {
        this.mission()!.cinematics.splice(index, 1);
        this.commit();
      });
      return;
    }
    if (act === 'add-step') {
      this.addStep(index, button.dataset.kind as MissionCinematicStep['kind']);
      return;
    }
    if (act === 'remove-step' || act === 'step-up' || act === 'step-down') {
      this.moveStep(index, Number(button.dataset.step ?? 0), act);
      return;
    }
    if (act === 'preview-cinematic') {
      const cinematic = this.mission()!.cinematics[index];
      if (cinematic) this.app.previewCinematicFromEditor(cinematic);
      return;
    }
  };

  private onChange = (event: Event): void => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el) return;
    const scope = el.dataset.scope;
    if (!scope) return;
    const doc = this.mission();
    if (!doc) return;
    const index = Number(el.dataset.index ?? 0);
    const fieldName = el.dataset.field ?? '';
    const value = el.type === 'checkbox' ? (el as HTMLInputElement).checked : el.value;
    if (scope === 'mission') {
      if (fieldName === 'id') doc.id = String(value);
      if (fieldName === 'title') doc.title = String(value);
      if (fieldName === 'description') doc.description = String(value);
      if (fieldName === 'author') doc.author = String(value);
    } else if (scope === 'campaign') {
      const campaignId = String(
        (this.root?.querySelector<HTMLInputElement>('[data-scope="campaign"][data-field="campaignId"]')?.value ?? ''),
      ).trim();
      const order = num(
        this.root?.querySelector<HTMLInputElement>('[data-scope="campaign"][data-field="order"]')?.value ?? '1',
        1,
      );
      const side =
        this.root?.querySelector<HTMLSelectElement>('[data-scope="campaign"][data-field="side"]')?.value ?? '';
      if (fieldName === 'campaignId') {
        if (!campaignId) delete doc.campaign;
        else {
          doc.campaign = {
            campaignId,
            order: doc.campaign?.order ?? order,
            ...(side ? { side: side as 'defender' | 'eastern' } : {}),
          };
        }
      } else if (doc.campaign) {
        doc.campaign.order = Math.max(1, Math.round(order));
        if (side) doc.campaign.side = side as 'defender' | 'eastern';
        else delete doc.campaign.side;
      }
    } else if (scope === 'briefing') {
      const briefing = doc.briefing as unknown as Record<string, unknown>;
      if (fieldName) briefing[fieldName] = value;
    } else if (scope === 'briefList') {
      const key = el.dataset.list === 'instructions' ? 'instructions' : 'personnel';
      const list = (doc.briefing[key] ?? []) as string[];
      list[index] = String(value);
      doc.briefing[key] = list;
    } else if (scope === 'debrief') {
      if (!doc.debrief) doc.debrief = {};
      if (fieldName === 'victory') doc.debrief.victory = String(value);
      if (fieldName === 'defeat') doc.debrief.defeat = String(value);
    } else if (scope === 'objective') {
      const objective = doc.objectives[index];
      if (!objective) return;
      if (fieldName === 'id') objective.id = String(value);
      if (fieldName === 'title') objective.title = String(value);
      if (fieldName === 'description') objective.description = String(value);
      if (fieldName === 'kind') objective.kind = String(value) as MissionObjectiveKind;
      if (fieldName === 'initialState') {
        if (String(value) === 'hidden') objective.initialState = 'hidden';
        else delete objective.initialState;
      }
    } else if (scope === 'objective-dep') {
      const objective = doc.objectives[index];
      const dependency = el.dataset.value ?? '';
      if (!objective) return;
      const already = objective.dependsOn.includes(dependency);
      const checked = (el as HTMLInputElement).checked;
      if (checked && !already) {
        // Rejecting the edit instead of accepting it and reporting a cycle keeps
        // the graph valid; the checkbox is re-rendered back to its prior state.
        if (wouldCreateDependencyCycle(doc, objective.id, dependency)) {
          this.app.notify(
            `"${objective.id}" cannot depend on "${dependency}": that would close a dependency loop.`,
            'warning',
          );
          this.render();
          return;
        }
        objective.dependsOn = [...objective.dependsOn, dependency];
      } else if (!checked && already) {
        objective.dependsOn = objective.dependsOn.filter((id) => id !== dependency);
      }
    } else if (scope === 'objective-entity-add') {
      const objective = doc.objectives[index];
      const key = String(el.value);
      if (!objective || !key) return;
      objective.protectedEntities = [...new Set([...(objective.protectedEntities ?? []), key])];
    } else if (scope === 'variable') {
      const variable = doc.variables[index];
      if (!variable) return;
      if (fieldName === 'id') variable.id = String(value);
      if (fieldName === 'type') {
        variable.type = String(value) as MissionVariableType;
        variable.default = variable.type === 'number' ? 0 : variable.type === 'boolean' ? false : '';
        this.app.notify(
          `Variable "${variable.id}" is now ${variable.type}; its default was reset to match.`,
          'info',
        );
      }
      if (fieldName === 'default') variable.default = parseMissionValue(variable.type, String(value));
      if (fieldName === 'description') variable.description = String(value);
    } else if (scope === 'region') {
      const region = doc.regions[index];
      if (!region) return;
      if (fieldName === 'id') {
        const previous = region.id;
        region.id = String(value);
        // Keep the map selection pointing at the same rectangle after a rename
        // rather than dropping the highlight on the floor.
        if (this.selectedRegionId === previous) {
          this.selectedRegionId = region.id;
          this.editor.selectRegion(region.id);
        }
      }
      if (fieldName === 'name') region.name = String(value);
      if (fieldName === 'x') region.x = Math.max(0, Math.round(num(String(value))));
      if (fieldName === 'z') region.z = Math.max(0, Math.round(num(String(value))));
      if (fieldName === 'width') region.width = Math.max(1, Math.round(num(String(value), 1)));
      if (fieldName === 'height') region.height = Math.max(1, Math.round(num(String(value), 1)));
    } else if (scope === 'ai-group') {
      const group = doc.aiGroups[index];
      if (!group) return;
      if (fieldName === 'id') group.id = String(value);
      if (fieldName === 'owner') group.owner = Math.max(0, Math.round(num(String(value))));
      if (fieldName === 'task') group.task = String(value) as typeof group.task;
      if (fieldName === 'initial') {
        if (String(value) === 'dormant') group.initial = 'dormant';
        else delete group.initial;
      }
      if (fieldName === 'region') {
        if (String(value)) group.region = String(value);
        else delete group.region;
      }
    } else if (scope === 'group-unit') {
      const group = doc.aiGroups[index];
      const unitIndex = Number(el.dataset.unit ?? 0);
      if (!group || group.units[unitIndex] === undefined) return;
      group.units[unitIndex] = String(value);
    } else if (scope === 'group-unit-add') {
      const group = doc.aiGroups[index];
      const key = String(el.value);
      if (!group || !key || group.units.includes(key)) return;
      group.units = [...group.units, key];
    } else if (scope === 'reinforcement') {
      const wave = doc.reinforcements[index];
      if (!wave) return;
      if (fieldName === 'id') wave.id = String(value);
      if (fieldName === 'owner') wave.owner = Math.max(0, Math.round(num(String(value))));
      if (fieldName === 'region') wave.region = String(value);
      if (fieldName === 'afterSeconds') {
        if (String(value).trim() === '') delete wave.afterSeconds;
        else wave.afterSeconds = Math.max(0, num(String(value)));
      }
      if (fieldName === 'triggerId') {
        if (String(value)) wave.triggerId = String(value);
        else delete wave.triggerId;
      }
    } else if (scope === 'wave-unit') {
      const wave = doc.reinforcements[index];
      const unit = wave?.units[Number(el.dataset.unit ?? 0)];
      if (!unit) return;
      if (fieldName === 'defId') unit.defId = String(value);
      if (fieldName === 'count') unit.count = Math.max(1, Math.round(num(String(value), 1)));
    } else if (scope === 'wave-unit-add') {
      const wave = doc.reinforcements[index];
      const defId = String(el.value);
      if (!wave || !defId) return;
      wave.units = [...wave.units, { defId, count: 1 }];
    } else if (scope === 'trigger') {
      const trigger = doc.triggers[index];
      if (!trigger) return;
      if (fieldName === 'id') trigger.id = String(value);
      if (fieldName === 'priority') trigger.priority = Math.round(num(String(value)));
      if (fieldName === 'once') trigger.once = Boolean(value);
      if (fieldName === 'delaySeconds') {
        if (String(value).trim() === '') delete trigger.delaySeconds;
        else trigger.delaySeconds = Math.max(0, num(String(value)));
      }
      if (fieldName === 'cooldownSeconds') {
        if (String(value).trim() === '') delete trigger.cooldownSeconds;
        else trigger.cooldownSeconds = Math.max(0, num(String(value)));
      }
    } else if (scope === 'condition-kind') {
      const trigger = doc.triggers[Number(el.dataset.trigger ?? 0)];
      if (trigger) trigger.conditions[Number(el.dataset.index ?? 0)] = defaultCondition(String(value));
    } else if (scope === 'condition') {
      const trigger = doc.triggers[Number(el.dataset.trigger ?? 0)];
      const condition = trigger?.conditions[Number(el.dataset.index ?? 0)];
      if (!condition) return;
      mutateCondition(condition, fieldName, String(value), doc);
    } else if (scope === 'action-kind') {
      const trigger = doc.triggers[Number(el.dataset.trigger ?? 0)];
      if (trigger) trigger.actions[Number(el.dataset.index ?? 0)] = defaultAction(String(value), doc);
    } else if (scope === 'action') {
      const trigger = doc.triggers[Number(el.dataset.trigger ?? 0)];
      const action = trigger?.actions[Number(el.dataset.index ?? 0)];
      if (!action) return;
      mutateAction(action, fieldName, String(value), doc);
    } else if (scope === 'cinematic') {
      const cinematic = doc.cinematics[index];
      if (!cinematic) return;
      if (fieldName === 'id') cinematic.id = String(value);
      if (fieldName === 'kind') cinematic.kind = String(value) as MissionCinematicContext;
      if (fieldName === 'skippable') cinematic.skippable = Boolean(value);
      if (fieldName === 'atSeconds') {
        if (String(value).trim() === '') delete cinematic.atSeconds;
        else cinematic.atSeconds = Math.max(0, num(String(value)));
      }
    } else if (scope === 'step-target-kind') {
      const cinematic = doc.cinematics[index];
      const step = cinematic?.steps[Number(el.dataset.step ?? 0)];
      if (!step || step.kind !== 'camera') return;
      step.target =
        String(value) === 'entity'
          ? { kind: 'entity', entity: this.cinematicFocusKey() ?? 'own-hq' }
          : { kind: 'position', x: this.editor.scenario.width / 2, z: this.editor.scenario.height / 2 };
    } else if (scope.startsWith('step-target-')) {
      const cinematic = doc.cinematics[index];
      const step = cinematic?.steps[Number(el.dataset.step ?? 0)];
      if (!step || step.kind !== 'camera') return;
      if (scope === 'step-target-entity' && step.target.kind === 'entity') {
        step.target.entity = String(value);
      } else if (step.target.kind === 'position') {
        if (scope === 'step-target-x') step.target.x = num(String(value));
        if (scope === 'step-target-z') step.target.z = num(String(value));
      }
    } else if (scope === 'step') {
      const cinematic = doc.cinematics[index];
      const step = cinematic?.steps[Number(el.dataset.step ?? 0)];
      if (!step) return;
      if (fieldName === 'zoom') {
        if (step.kind === 'camera') {
          if (String(value).trim() === '') delete step.zoom;
          else step.zoom = Math.max(1, Math.min(110, num(String(value))));
        }
      }
      if (fieldName === 'durationSeconds') {
        step.durationSeconds = Math.max(step.kind === 'camera' ? 0 : 0.1, num(String(value), step.kind === 'camera' ? 0 : 1));
      }
      if (fieldName === 'holdSeconds' && step.kind === 'camera') {
        step.holdSeconds = Math.max(0, num(String(value)));
      }
      if (fieldName === 'pauseSeconds' && step.kind === 'line') {
        step.pauseSeconds = Math.max(0, num(String(value)));
      }
      if (fieldName === 'speaker' && step.kind === 'line') step.speaker = String(value);
      if (fieldName === 'text' && (step.kind === 'line' || step.kind === 'notify')) step.text = String(value);
    }
    this.commit();
  };

  /* ------------------------------------------------------------------ */
  /* Mutations                                                           */
  /* ------------------------------------------------------------------ */

  private briefList(act: string, key: 'personnel' | 'instructions', index: number): void {
    const doc = this.mission()!;
    const list = [...(doc.briefing[key] ?? [])];
    if (act === 'add-brief-list') list.push('');
    else list.splice(index, 1);
    doc.briefing[key] = list;
    this.commit();
  }

  private addObjective(): void {
    const doc = this.mission()!;
    let id = 'objective';
    let n = doc.objectives.length + 1;
    while (doc.objectives.some((entry) => entry.id === id)) id = `objective-${n++}`;
    doc.objectives.push({ id, title: 'New objective', description: '', kind: 'secondary', dependsOn: [] });
    this.commit();
  }

  /**
   * Remove an objective, never silently breaking what points at it.
   *
   * An unreferenced objective is a simple confirmation. A referenced one asks
   * for a decision between cleaning the references up and leaving them visibly
   * broken, because both are legitimate: a stub can be repaired later, a clean
   * removal cannot be undone by inspection.
   */
  private removeObjective(index: number): void {
    const doc = this.mission()!;
    const objective = doc.objectives[index];
    if (!objective) return;
    const refs = objectiveReferences(doc, objective.id);
    if (refs.length === 0) {
      this.confirmRemove(`Remove objective "${objective.title}"?`, () => {
        doc.objectives.splice(index, 1);
        this.commit();
      });
      return;
    }
    const dependents = objectiveDependents(doc, objective.id);
    const triggers = doc.triggers.filter(
      (trigger) =>
        trigger.actions.some((action) => action.kind === 'setObjective' && action.objective === objective.id) ||
        trigger.conditions.some((condition) => condition.kind === 'objective' && condition.objective === objective.id),
    );
    openModal({
      title: 'Objective is referenced',
      body: `<p><b>${escapeHtml(objective.title)}</b> (<code>${escapeHtml(objective.id)}</code>) is used in ${refs.length} place${refs.length === 1 ? '' : 's'}:</p>
        <ul class="wb-warning-list">
          ${dependents.map((entry) => `<li>Prerequisite of <b>${escapeHtml(entry.title || entry.id)}</b> <code>${escapeHtml(entry.id)}</code></li>`).join('')}
          ${triggers.map((trigger) => `<li>Referenced by trigger <b>${escapeHtml(trigger.id)}</b></li>`).join('')}
        </ul>
        <p>Cleaning up removes it from those prerequisites and deletes the trigger conditions and actions that name it. Removing as-is keeps the authored text and shows validation errors you can repair.</p>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Remove and clean references',
          onClick: () => {
            cleanObjectiveReferences(doc, objective.id);
            doc.objectives.splice(index, 1);
            this.commit();
          },
        },
        {
          label: 'Remove as-is',
          primary: true,
          danger: true,
          onClick: () => {
            doc.objectives.splice(index, 1);
            this.commit();
          },
        },
      ],
    });
  }

  private addVariable(): void {
    const doc = this.mission()!;
    let id = 'variable';
    let n = doc.variables.length + 1;
    while (doc.variables.some((entry) => entry.id === id)) id = `variable-${n++}`;
    doc.variables.push({ id, type: 'number', default: 0 });
    this.commit();
  }

  private removeVariable(index: number): void {
    const doc = this.mission()!;
    const variable = doc.variables[index];
    if (!variable) return;
    const refs = variableReferences(doc, variable.id);
    this.confirmRemove(
      refs.length ? `"${variable.id}" is referenced by ${refs.join(', ')}. Remove anyway?` : `Remove variable "${variable.id}"?`,
      () => {
        doc.variables.splice(index, 1);
        this.commit();
      },
    );
  }

  private addRegion(): void {
    const doc = this.mission()!;
    let id = 'region';
    let n = doc.regions.length + 1;
    while (doc.regions.some((entry) => entry.id === id)) id = `region-${n++}`;
    doc.regions.push({
      id,
      x: Math.floor(this.editor.scenario.width / 4),
      z: Math.floor(this.editor.scenario.height / 4),
      width: Math.max(2, Math.floor(this.editor.scenario.width / 4)),
      height: Math.max(2, Math.floor(this.editor.scenario.height / 4)),
    });
    this.showRegions = true;
    this.editor.showRegions = true;
    this.commit();
  }

  private removeRegion(index: number): void {
    const doc = this.mission()!;
    const region = doc.regions[index];
    if (!region) return;
    const refs = regionReferences(doc, region.id);
    this.confirmRemove(
      refs.length ? `"${region.id}" is referenced by ${refs.join(', ')}. Removing it leaves those references dangling. Remove anyway?` : `Remove region "${region.id}"?`,
      () => {
        doc.regions.splice(index, 1);
        if (this.selectedRegionId === region.id) {
          this.selectedRegionId = null;
          this.editor.selectRegion(null);
        }
        this.commit();
      },
    );
  }

  /** The first player who is not the local commander. */
  private opposingOwner(): number {
    const players = this.editor.scenario.players;
    const local = players[0]?.id ?? 0;
    return players.find((player) => player.id !== local)?.id ?? 1;
  }

  private addAiGroup(): void {
    const doc = this.mission()!;
    let id = 'group';
    let n = doc.aiGroups.length + 1;
    while (doc.aiGroups.some((entry) => entry.id === id)) id = `group-${n++}`;
    doc.aiGroups.push({
      id,
      owner: this.opposingOwner(),
      task: 'defend',
      units: [],
      initial: 'dormant',
      ...(doc.regions[0] ? { region: doc.regions[0].id } : {}),
    });
    this.commit();
  }

  private removeAiGroup(index: number): void {
    const doc = this.mission()!;
    const group = doc.aiGroups[index];
    if (!group) return;
    const refs = doc.triggers
      .map((trigger, ti) =>
        trigger.actions.some((action) => action.kind === 'activateAiGroup' && action.group === group.id)
          ? `triggers[${ti}]`
          : '',
      )
      .filter(Boolean);
    this.confirmRemove(
      refs.length
        ? `"${group.id}" is referenced by ${refs.join(', ')}. Removing it leaves those actions pointing at nothing. Remove anyway?`
        : `Remove AI group "${group.id}"?`,
      () => {
        doc.aiGroups.splice(index, 1);
        this.commit();
      },
    );
  }

  private removeGroupUnit(index: number, unitIndex: number): void {
    const group = this.mission()!.aiGroups[index];
    if (!group) return;
    group.units.splice(unitIndex, 1);
    this.commit();
  }

  private addReinforcement(): void {
    const doc = this.mission()!;
    let id = 'wave';
    let n = doc.reinforcements.length + 1;
    while (doc.reinforcements.some((entry) => entry.id === id)) id = `wave-${n++}`;
    const defId = 'rifle' in UNITS ? 'rifle' : (Object.keys(UNITS)[0] ?? 'rifle');
    doc.reinforcements.push({
      id,
      owner: this.opposingOwner(),
      region: doc.regions[0]?.id ?? '',
      units: [{ defId, count: 2 }],
      afterSeconds: 60,
    });
    this.commit();
  }

  private removeReinforcement(index: number): void {
    const doc = this.mission()!;
    const wave = doc.reinforcements[index];
    if (!wave) return;
    const refs = doc.triggers
      .map((trigger, ti) =>
        trigger.actions.some(
          (action) => action.kind === 'spawnReinforcement' && action.reinforcement === wave.id,
        )
          ? `triggers[${ti}]`
          : '',
      )
      .filter(Boolean);
    this.confirmRemove(
      refs.length
        ? `"${wave.id}" is requested by ${refs.join(', ')}. Removing it leaves those actions pointing at nothing. Remove anyway?`
        : `Remove reinforcement "${wave.id}"?`,
      () => {
        doc.reinforcements.splice(index, 1);
        this.commit();
      },
    );
  }

  private removeWaveUnit(index: number, unitIndex: number): void {
    const wave = this.mission()!.reinforcements[index];
    if (!wave) return;
    wave.units.splice(unitIndex, 1);
    this.commit();
  }

  private addTrigger(): void {
    const doc = this.mission()!;
    let id = 'trigger';
    let n = doc.triggers.length + 1;
    while (doc.triggers.some((entry) => entry.id === id)) id = `trigger-${n++}`;
    doc.triggers.push({
      id,
      priority: 0,
      once: true,
      conditions: [{ kind: 'elapsed', seconds: 30 }],
      actions: [{ kind: 'message', text: 'Trigger fired.' }],
    });
    this.commit();
  }

  /** Reorder or remove one condition/action list item in authored order. */
  private moveAuthoredItem(
    triggerIndex: number,
    key: 'conditions' | 'actions',
    itemIndex: number,
    act: string,
  ): void {
    const trigger = this.mission()!.triggers[triggerIndex];
    const list = trigger?.[key];
    if (!list) return;
    if (act.startsWith('remove')) list.splice(itemIndex, 1);
    else {
      const to = act.endsWith('up') ? itemIndex - 1 : itemIndex + 1;
      if (to < 0 || to >= list.length) return;
      [list[itemIndex], list[to]] = [list[to], list[itemIndex]];
    }
    this.commit();
  }

  private addCondition(index: number): void {
    const trigger = this.mission()!.triggers[index];
    if (!trigger) return;
    trigger.conditions.push(defaultCondition('elapsed'));
    this.commit();
  }

  private addAction(index: number): void {
    const trigger = this.mission()!.triggers[index];
    if (!trigger) return;
    trigger.actions.push(defaultAction('setObjective', this.mission()!));
    this.commit();
  }

  /** Friendly ground reads on screen; a fogged enemy tile does not. */
  private cinematicFocusKey(): string | undefined {
    const local = this.editor.scenario.players[0]?.id ?? 0;
    const own = this.editor.scenario.structures.find(
      (structure) => structure.key && structure.owner === local,
    )?.key;
    return own ?? authoredEntityKeys(this.editor.scenario)[0];
  }

  private addCinematic(): void {
    const doc = this.mission()!;
    const used = new Set(doc.cinematics.map((entry) => entry.kind));
    const kind = CINEMATIC_KINDS.find((entry) => !used.has(entry)) ?? 'inMission';
    let id: string = kind;
    let n = 2;
    while (doc.cinematics.some((entry) => entry.id === id)) id = `${kind}-${n++}`;
    const key = this.cinematicFocusKey();
    doc.cinematics.push({
      id,
      kind,
      skippable: true,
      ...(kind === 'inMission' ? { atSeconds: 30 } : {}),
      steps: [
        key
          ? { kind: 'camera', target: { kind: 'entity', entity: key }, durationSeconds: 0, holdSeconds: 1 }
          : {
              kind: 'camera',
              target: { kind: 'position', x: this.editor.scenario.width / 2, z: this.editor.scenario.height / 2 },
              durationSeconds: 0,
              holdSeconds: 1,
            },
        { kind: 'line', speaker: 'Command', text: 'New scene.', durationSeconds: 4 },
      ],
      dialogue: [],
    });
    this.commit();
  }

  private addStep(index: number, kind: MissionCinematicStep['kind']): void {
    const cinematic = this.mission()!.cinematics[index];
    if (!cinematic) return;
    let step: MissionCinematicStep;
    if (kind === 'camera') {
      const key = this.cinematicFocusKey();
      step = key
        ? { kind: 'camera', target: { kind: 'entity', entity: key }, durationSeconds: 2, holdSeconds: 0.5 }
        : {
            kind: 'camera',
            target: { kind: 'position', x: this.editor.scenario.width / 2, z: this.editor.scenario.height / 2 },
            durationSeconds: 2,
            holdSeconds: 0.5,
          };
    } else if (kind === 'line') {
      step = { kind: 'line', speaker: 'Command', text: 'New line.', durationSeconds: 4 };
    } else {
      step = { kind: 'notify', text: 'New notice.', durationSeconds: 3 };
    }
    cinematic.steps.push(step);
    this.commit();
  }

  private moveStep(index: number, stepIndex: number, act: string): void {
    const cinematic = this.mission()!.cinematics[index];
    if (!cinematic) return;
    if (act === 'remove-step') cinematic.steps.splice(stepIndex, 1);
    else {
      const to = act === 'step-up' ? stepIndex - 1 : stepIndex + 1;
      if (to < 0 || to >= cinematic.steps.length) return;
      [cinematic.steps[stepIndex], cinematic.steps[to]] = [cinematic.steps[to], cinematic.steps[stepIndex]];
    }
    this.commit();
  }

  private confirmRemove(message: string, action: () => void, title = 'Confirm removal'): void {
    openModal({
      title,
      body: `<p>${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancel' },
        { label: title === 'Confirm removal' ? 'Remove' : 'Confirm', primary: true, onClick: action },
      ],
    });
  }

  /* ------------------------------------------------------------------ */
  /* Library, export and test                                            */
  /* ------------------------------------------------------------------ */

  private save(): void {
    const doc = this.mission();
    if (!doc) return;
    if (this.campaignLocked()) {
      this.app.notify('This is a campaign document. Duplicate it to edit a copy.', 'warning');
      return;
    }
    try {
      const entry = saveScenarioToLibrary(this.storage, this.editor.scenario, {
        ...(this.entryId ? { id: this.entryId } : {}),
      });
      this.entryId = entry.id;
      this.savedMissionJson = this.missionJsonOf(entry.scenarioJson);
      // The store now holds this document, so no comparison is needed here: a
      // canonical round-trip can reorder fields without the content changing.
      this.dirty = false;
      this.storageError = null;
      this.app.notify(`Saved "${entry.title}" to the mission library.`, 'success');
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.storageError = message;
      openModal({
        title: 'Mission not saved',
        body: `<p>${escapeHtml(message)}</p>
          <p>The saved library copy has not been changed and this document is still open. Export it now if storage stays unavailable.</p>`,
        actions: [
          { label: 'Export mission JSON', onClick: () => this.exportMissionOnly() },
          { label: 'Export scenario', onClick: () => this.exportScenarioDocument() },
          { label: 'Close', primary: true },
        ],
      });
      this.render();
    }
  }

  private exportMissionOnly(): void {
    const mission = this.mission();
    if (!mission) return;
    downloadJson(libraryFilename(mission.title, 'mission'), missionJson(mission));
    this.app.notify('Mission JSON downloaded.', 'success');
  }

  private exportScenarioDocument(): void {
    const mission = this.mission();
    if (!mission) return;
    downloadJson(libraryFilename(mission.title, 'scenario'), scenarioJsonForExport(this.editor.scenario));
    this.app.notify('Scenario with embedded mission downloaded.', 'success');
  }

  /** Restore the latest browser draft, which may not validate. */
  private restoreDraft(): void {
    const draft = this.editor.draftState();
    if (!draft.present) {
      this.app.notify('No browser draft is stored yet.', 'warning');
      return;
    }
    if (!draft.scenario) {
      this.app.notify(draft.error ?? 'The stored draft cannot be read.', 'critical');
      return;
    }
    const when = draft.meta ? new Date(draft.meta.savedAt).toLocaleString() : 'an earlier session';
    this.confirmRemove(
      `Replace the document open now with the browser draft saved ${when}? The saved library copy is not changed until you save again.`,
      () => {
        this.editor.loadScenario(draft.scenario!);
        this.app.notify('Browser draft restored.', 'success');
      },
      'Restore draft',
    );
  }

  private saveCopy(): void {
    if (!this.entryId) return;
    try {
      const entry = duplicateLibraryEntry(this.storage, this.entryId);
      const scenario = parseScenario(JSON.parse(entry.scenarioJson));
      this.editor.loadScenario(scenario);
      this.entryId = entry.id;
      this.savedMissionJson = JSON.stringify(scenario.mission ?? {});
      this.dirty = false;
      this.app.notify('Saved a detached copy in the mission library.', 'success');
      this.render();
    } catch (error) {
      this.app.notify(`Could not save a copy: ${error instanceof Error ? error.message : String(error)}`, 'critical');
    }
  }

  /** Reload the mission exactly as the library last stored it. */
  private revertToSaved(): void {
    if (!this.entryId) return;
    const entry = this.entries().find((item) => item.id === this.entryId);
    if (!entry) return;
    this.confirmRemove('Revert the mission to its last saved library copy? Current mission edits are discarded; the map itself is unchanged.', () => {
      try {
        const scenario = parseScenario(JSON.parse(entry.scenarioJson));
        if (!scenario.mission) return;
        this.editor.scenario.mission = scenario.mission;
        this.savedMissionJson = this.missionJsonOf(entry.scenarioJson);
        this.recomputeDirty();
        this.editor.missionChanged();
        this.app.notify('Mission reverted to the saved library copy.', 'info');
        this.render();
      } catch (error) {
        this.app.notify(`Could not revert: ${error instanceof Error ? error.message : String(error)}`, 'critical');
      }
    }, 'Revert mission');
  }

  /**
   * Restore the older snapshot that validated cleanly.
   *
   * Only offered when it genuinely differs from the saved copy, so the action
   * can never look like a successful restore that changed nothing. The restored
   * document is deliberately left marked unsaved: it is not yet the library
   * copy, and pretending otherwise is how previous work gets lost.
   */
  private restoreLastValid(): void {
    const entry = this.entries().find((item) => item.id === this.entryId);
    if (!entry) return;
    if (!canRestoreLastValid(entry) || !entry.lastValidScenarioJson) {
      this.app.notify(
        entry.lastValidAt
          ? 'The last validated snapshot is the saved copy, so there is no older version to restore.'
          : 'No validated snapshot has been stored for this document yet.',
        'warning',
      );
      return;
    }
    const when = new Date(entry.lastValidAt ?? entry.updatedAt).toLocaleString();
    this.confirmRemove(
      `Restore the mission from the snapshot validated ${when}? The current mission edits are replaced. The result stays unsaved until you save it.`,
      () => {
        try {
          const scenario = parseScenario(JSON.parse(entry.lastValidScenarioJson!));
          if (!scenario.mission) return;
          this.editor.scenario.mission = scenario.mission;
          this.savedMissionJson = this.missionJsonOf(entry.scenarioJson);
          this.recomputeDirty();
          this.editor.missionChanged();
          this.app.notify('Restored the last validated snapshot. Save to make it the library copy.', 'success');
          this.render();
        } catch (error) {
          this.app.notify(`Could not restore: ${error instanceof Error ? error.message : String(error)}`, 'critical');
        }
      },
      'Restore snapshot',
    );
  }

  private importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void readFileText(file).then((text) => this.previewImportText(text));
    });
    input.click();
  }

  private previewImportText(text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      openModal({
        title: 'Import failed',
        body: `<p>The file is not valid JSON: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`,
        actions: [{ label: 'Close', primary: true }],
      });
      return;
    }
    const scenario = this.editor.scenario;
    let preview: ImportPreview;
    try {
      preview = previewImport(raw, {
        width: scenario.width,
        height: scenario.height,
        entityKeys: new Set(authoredEntityKeys(scenario)),
        scenario,
      });
    } catch (error) {
      openModal({
        title: 'Import rejected',
        body: `<p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><p>No library document was changed.</p>`,
        actions: [{ label: 'Close', primary: true }],
      });
      return;
    }
    const conflicts = this.entries().filter((entry) => entry.missionId === preview.mission.id);
    const lockedConflicts = conflicts.filter((entry) => entry.campaignId !== null);
    const currentEntry = this.entries().find((entry) => entry.id === this.entryId);
    const currentLocked = currentEntry?.campaignId != null;
    const warnings = preview.issues.filter((issue) => issue.severity === 'warning');
    const body = `
      <div class="wb-import">
        <div class="wb-summary-strip">
          <div><span>KIND</span><b>${preview.kind === 'scenario' ? 'SCENARIO' : 'MISSION'}</b><small>${preview.kind === 'scenario' ? 'Includes placements, settings and mission' : 'Mission document only'}</small></div>
          <div><span>MISSION</span><b>${escapeHtml(preview.mission.id)}</b><small>v${preview.mission.version} · ${escapeHtml(preview.mission.title)}</small></div>
          <div><span>CAMPAIGN</span><b>${escapeHtml(preview.mission.campaign?.campaignId ?? 'STANDALONE')}</b><small>${preview.mission.campaign ? `order ${preview.mission.campaign.order}` : 'no campaign association'}</small></div>
          <div><span>WARNINGS</span><b>${preview.warnings}</b><small>${preview.errors ? `${preview.errors} errors block import` : 'No blocking errors'}</small></div>
        </div>
        ${warnings.length ? `<ul class="wb-warning-list">${warnings.map((issue) => `<li><b>${escapeHtml(issue.path)}</b> ${escapeHtml(issue.message)}</li>`).join('')}</ul>` : ''}
        ${
          conflicts.length
            ? `<p class="wb-warning">The library already stores mission <b>${escapeHtml(preview.mission.id)}</b>${conflicts.map((entry) => ` as “${escapeHtml(entry.title)}”`).join(', ')}.${lockedConflicts.length ? ' Campaign copies are protected and cannot be replaced.' : ''}</p>`
            : ''
        }
        ${preview.kind === 'mission' ? '<p class="wb-warning">A mission-only file is attached to the scenario currently open in the workbench, so it can resolve placement keys and map bounds.</p>' : ''}
      </div>`;
    const actions: Array<{ label: string; primary?: boolean; onClick?: () => void }> = [
      { label: 'Cancel' },
      {
        label: preview.kind === 'scenario' ? 'Import as copy' : 'Import as new mission',
        onClick: () => this.applyImport(preview, 'copy'),
      },
    ];
    if (conflicts.length && lockedConflicts.length === 0) {
      actions.push({
        label: 'Replace existing',
        primary: true,
        onClick: () => this.applyImport(preview, 'replace'),
      });
    } else if (!conflicts.length) {
      actions.push({
        label: 'Add to library',
        primary: true,
        onClick: () => this.applyImport(preview, 'add'),
      });
    }
    if (preview.kind === 'mission' && !currentLocked) {
      actions.push({
        label: 'Replace current mission',
        onClick: () => this.applyImport(preview, 'current'),
      });
    }
    openModal({ title: 'Import preview', body, wide: true, actions });
  }

  private applyImport(preview: ImportPreview, mode: 'add' | 'copy' | 'replace' | 'current'): void {
    try {
      const entries = this.entries();
      if (mode === 'current') {
        const scenario = scenarioForImportedMission(this.editor.scenario, preview.mission);
        const entry = saveScenarioToLibrary(this.storage, scenario, {
          ...(this.entryId ? { id: this.entryId } : {}),
        });
        this.editor.loadScenario(scenario);
        this.entryId = entry.id;
        this.savedMissionJson = JSON.stringify(scenario.mission ?? {});
        this.dirty = false;
        closeModal();
        this.app.notify('Imported mission attached to the current scenario.', 'success');
        this.render();
        return;
      }
      if (!preview.scenario) {
        // Attach a mission-only import to the current map, then store the pair.
        const scenario =
          mode === 'copy'
            ? scenarioForImportedMission(this.editor.scenario, {
                ...preview.mission,
                id: nextMissionIdForScenario(this.editor.scenario, entries),
                title: `${preview.mission.title} (Copy)`,
              })
            : scenarioForImportedMission(this.editor.scenario, preview.mission);
        const entry = saveScenarioToLibrary(this.storage, scenario);
        this.editor.loadScenario(scenario);
        this.entryId = entry.id;
        this.savedMissionJson = JSON.stringify(scenario.mission ?? {});
        this.dirty = false;
        closeModal();
        this.app.notify('Imported mission added to the library.', 'success');
        this.render();
        return;
      }
      let scenario =
        mode === 'copy'
          ? copyOfImportedScenario(
              preview.scenario,
              new Set(entries.map((entry) => entry.missionId)),
            )
          : preview.scenario;
      const conflict = entries.find((entry) => entry.missionId === preview.mission.id);
      if (mode === 'replace' && conflict) {
        if (conflict.campaignId !== null) {
          throw new Error('Campaign library documents are protected from replacement.');
        }
        const entry = saveScenarioToLibrary(this.storage, scenario, { id: conflict.id });
        this.editor.loadScenario(scenario);
        this.entryId = entry.id;
      } else {
        const entry = saveScenarioToLibrary(this.storage, scenario);
        this.editor.loadScenario(scenario);
        this.entryId = entry.id;
      }
      this.savedMissionJson = JSON.stringify(scenario.mission ?? {});
      this.dirty = false;
      closeModal();
      this.app.notify('Imported scenario and mission into the library.', 'success');
      this.render();
    } catch (error) {
      this.app.notify(`Import failed: ${error instanceof Error ? error.message : String(error)}`, 'critical');
    }
  }
}

/**
 * Drop every authored reference to an objective.
 *
 * Only used behind the explicit "remove and clean references" choice: the
 * alternative is to leave the references visible as errors.
 */
function cleanObjectiveReferences(doc: MissionDoc, objectiveId: string): void {
  for (const objective of doc.objectives) {
    if (objective.dependsOn.includes(objectiveId)) {
      objective.dependsOn = objective.dependsOn.filter((id) => id !== objectiveId);
    }
  }
  for (const trigger of doc.triggers) {
    trigger.conditions = trigger.conditions.filter(
      (condition) => !(condition.kind === 'objective' && condition.objective === objectiveId),
    );
    trigger.actions = trigger.actions.filter(
      (action) => !(action.kind === 'setObjective' && action.objective === objectiveId),
    );
  }
}

function defaultCondition(kind: string): MissionCondition {
  switch (kind) {
    case 'variable':
      return { kind: 'variable', variable: '', op: 'eq', value: 0 };
    case 'objective':
      return { kind: 'objective', objective: '', state: 'complete' };
    case 'entityAlive':
      return { kind: 'entityAlive', entity: '' };
    case 'entityDead':
      return { kind: 'entityDead', entity: '' };
    case 'regionOccupied':
      return { kind: 'regionOccupied', region: '', team: 0, atLeast: 1 };
    default:
      return { kind: 'elapsed', seconds: 30 };
  }
}

function defaultAction(kind: string, doc: MissionDoc): MissionAction {
  switch (kind) {
    case 'setObjective':
      return { kind: 'setObjective', objective: doc.objectives[0]?.id ?? '', state: 'complete' };
    case 'setVariable':
      return { kind: 'setVariable', variable: doc.variables[0]?.id ?? '', value: 0 };
    case 'activateAiGroup':
      return { kind: 'activateAiGroup', group: doc.aiGroups[0]?.id ?? '' };
    case 'spawnReinforcement':
      return { kind: 'spawnReinforcement', reinforcement: doc.reinforcements[0]?.id ?? '' };
    case 'endMission':
      return { kind: 'endMission', outcome: 'victory' };
    default:
      return { kind: 'message', text: 'Trigger fired.' };
  }
}

function mutateCondition(
  condition: MissionCondition,
  fieldName: string,
  raw: string,
  doc: MissionDoc,
): void {
  if (condition.kind === 'elapsed' && fieldName === 'seconds') {
    condition.seconds = Math.max(0, num(raw));
  } else if (condition.kind === 'variable') {
    if (fieldName === 'variable') condition.variable = raw;
    if (fieldName === 'op') condition.op = raw as typeof condition.op;
    if (fieldName === 'value') {
      const type = doc.variables.find((entry) => entry.id === condition.variable)?.type ?? 'string';
      condition.value = parseMissionValue(type, raw);
    }
  } else if (condition.kind === 'objective') {
    if (fieldName === 'objective') condition.objective = raw;
    if (fieldName === 'state') condition.state = raw as MissionObjectiveState;
  } else if (condition.kind === 'entityAlive' || condition.kind === 'entityDead') {
    if (fieldName === 'entity') condition.entity = raw;
  } else if (condition.kind === 'regionOccupied') {
    if (fieldName === 'region') condition.region = raw;
    if (fieldName === 'team') condition.team = Math.max(0, Math.round(num(raw)));
    if (fieldName === 'atLeast') condition.atLeast = Math.max(0, Math.round(num(raw)));
  }
}

function mutateAction(action: MissionAction, fieldName: string, raw: string, doc: MissionDoc): void {
  if (action.kind === 'setObjective') {
    if (fieldName === 'objective') action.objective = raw;
    if (fieldName === 'state') action.state = raw as MissionObjectiveState;
  } else if (action.kind === 'setVariable') {
    if (fieldName === 'variable') action.variable = raw;
    if (fieldName === 'value') {
      const type = doc.variables.find((entry) => entry.id === action.variable)?.type ?? 'string';
      action.value = parseMissionValue(type, raw);
    }
  } else if (action.kind === 'message' && fieldName === 'text') {
    action.text = raw;
  }
}

