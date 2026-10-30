import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, type Assignment, type AuthSession, type Dependency, type Organization, type OrganizationMember, type Project, type Schedule, type Task } from './api';
import './style.css';

function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assignment[]>>({});
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [screen, setScreen] = useState<'loading' | 'auth' | 'workspace'>('loading');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canManage = organization?.role === 'OWNER' || organization?.role === 'ADMIN';

  async function loadOrganizations(token: string) {
    setOrganizations(await api.organizations(token));
    setScreen('workspace');
  }

  async function openOrganization(value: Organization, token: string) {
    setBusy(true); setError('');
    try {
      setOrganization(value); setSelectedProject(null); setTasks([]); setSchedule(null);
      const [nextProjects, nextMembers] = await Promise.all([
        api.projects(token, value.id),
        value.role === 'OWNER' || value.role === 'ADMIN' ? api.members(token, value.id) : Promise.resolve([]),
      ]);
      setProjects(nextProjects); setMembers(nextMembers.filter((member) => member.status === 'ACTIVE'));
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function openProject(value: Project, token: string) {
    if (!organization) return;
    setBusy(true); setError('');
    try {
      const [nextTasks, analysis] = await Promise.all([
        api.tasks(token, organization.id, value.id), api.schedule(token, organization.id, value.id),
      ]);
      const [edgeGroups, assignmentGroups] = await Promise.all([
        Promise.all(nextTasks.map((task) => api.dependencies(token, organization.id, value.id, task.id))),
        Promise.all(nextTasks.map((task) => api.assignments(token, organization.id, value.id, task.id))),
      ]);
      const edges = new Map<string, Dependency>();
      for (const edge of edgeGroups.flat()) edges.set(edge.id, edge);
      setSelectedProject(value); setTasks(nextTasks); setSchedule(analysis);
      setDependencies([...edges.values()]);
      setAssignments(Object.fromEntries(nextTasks.map((task, index) => [task.id, assignmentGroups[index] ?? []])));
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function reloadProject() {
    if (!session || !organization || !selectedProject) return;
    const current = selectedProject;
    const updatedProject = await api.projects(session.accessToken, organization.id).then((items) => items.find((item) => item.id === current.id) ?? current);
    await openProject(updatedProject, session.accessToken);
  }

  useEffect(() => {
    let cancelled = false;
    void api.refresh().then(async (tokens) => {
      if (cancelled) return;
      setSession({ ...tokens, user: { id: '', email: '', displayName: 'Welcome back' } });
      await loadOrganizations(tokens.accessToken);
    }).catch(() => { if (!cancelled) setScreen('auth'); });
    return () => { cancelled = true; };
  }, []);

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      let authenticated: AuthSession;
      if (mode === 'register') {
        const user = await api.register({ email: String(form.get('email')), displayName: String(form.get('displayName')), password: String(form.get('password')) });
        authenticated = await api.login({ email: user.email, password: String(form.get('password')) });
      } else {
        authenticated = await api.login({ email: String(form.get('email')), password: String(form.get('password')) });
      }
      setSession(authenticated);
      await loadOrganizations(authenticated.accessToken);
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session) return;
    const formElement = event.currentTarget;
    setBusy(true); setError(''); const form = new FormData(formElement);
    try {
      await api.createOrganization(session.accessToken, { name: String(form.get('name')), slug: String(form.get('slug')) });
      setOrganizations(await api.organizations(session.accessToken));
      formElement.reset();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session || !organization) return;
    const formElement = event.currentTarget;
    setBusy(true); setError(''); const form = new FormData(formElement);
    try {
      await api.createProject(session.accessToken, organization.id, { name: String(form.get('name')), description: String(form.get('description')) || undefined });
      setProjects(await api.projects(session.accessToken, organization.id));
      formElement.reset();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session || !organization || !selectedProject) return;
    const formElement = event.currentTarget;
    setBusy(true); setError(''); const form = new FormData(formElement);
    try {
      await api.createTask(session.accessToken, organization.id, selectedProject.id, {
        name: String(form.get('name')), description: String(form.get('description')) || null,
        optimisticHours: Number(form.get('optimisticHours')), likelyHours: Number(form.get('likelyHours')),
        pessimisticHours: Number(form.get('pessimisticHours')),
      });
      formElement.reset(); await reloadProject();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function updateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session || !organization || !selectedProject) return;
    setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      const updated = await api.updateProject(session.accessToken, organization.id, selectedProject.id, {
        name: String(form.get('name')), description: String(form.get('description')) || null,
      });
      setSelectedProject(updated);
      setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function updateTask(event: React.FormEvent<HTMLFormElement>, task: Task) {
    event.preventDefault(); if (!session || !organization || !selectedProject) return;
    setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      await api.updateTask(session.accessToken, organization.id, selectedProject.id, task.id, {
        expectedVersion: task.version, name: String(form.get('name')),
        optimisticHours: Number(form.get('optimisticHours')), likelyHours: Number(form.get('likelyHours')),
        pessimisticHours: Number(form.get('pessimisticHours')),
      });
      await reloadProject();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function deleteTask(task: Task) {
    if (!session || !organization || !selectedProject) return;
    setBusy(true); setError('');
    try { await api.deleteTask(session.accessToken, organization.id, selectedProject.id, task.id, task.version); await reloadProject(); }
    catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function addDependency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session || !organization || !selectedProject) return;
    setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      await api.addDependency(session.accessToken, organization.id, selectedProject.id, {
        prerequisiteTaskId: String(form.get('prerequisiteTaskId')), dependentTaskId: String(form.get('dependentTaskId')),
      }); await reloadProject();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function addAssignment(event: React.FormEvent<HTMLFormElement>, task: Task) {
    event.preventDefault(); if (!session || !organization || !selectedProject) return;
    setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      await api.assign(session.accessToken, organization.id, selectedProject.id, task.id, String(form.get('membershipId')));
      await reloadProject();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (session) { try { await api.logout(session.accessToken); } catch { /* Discard local state if the API is unavailable. */ } }
    setSession(null); setOrganizations([]); setOrganization(null); setSelectedProject(null); setScreen('auth');
  }

  if (screen === 'loading') return <main className="loading"><span className="mark">F</span><p>Preparing your workspace…</p></main>;
  if (screen === 'auth') return <main className="auth-layout">
    <section className="brand-panel"><span className="mark">F</span><p className="eyebrow">ENGINEERING, IN FLOW</p><h1>Make complex work<br />move together.</h1><p className="muted">Plan projects, coordinate teams, and keep the path to delivery visible.</p><div className="decorative-grid" aria-hidden="true" /></section>
    <section className="form-panel"><div className="form-wrap"><p className="eyebrow">FLOWFORGE WORKSPACE</p><h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p className="muted">{mode === 'login' ? 'Sign in to continue to your engineering workspace.' : 'Start by creating your personal account.'}</p>
      <form onSubmit={authenticate} className="stack">
        {mode === 'register' && <label>Full name<input name="displayName" autoComplete="name" required maxLength={160} /></label>}
        <label>Email address<input type="email" name="email" autoComplete="email" required maxLength={320} /></label>
        <label>Password<input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="switch">{mode === 'login' ? 'New to FlowForge?' : 'Already have an account?'} <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
    </div></section>
  </main>;

  return <main className="workspace">
    <header className="topbar"><a className="wordmark" href="#"><span className="mark small">F</span> FlowForge</a><div className="top-actions"><span className="avatar">{session?.user.displayName.slice(0, 1).toUpperCase() || 'U'}</span><span className="user-name">{session?.user.displayName || 'Your account'}</span><button className="text-button" onClick={() => void signOut()}>Sign out</button></div></header>
    <section className="content">
      {selectedProject && organization ? <>
        <button className="back-button" onClick={() => { setSelectedProject(null); setSchedule(null); }}>← {organization.name}</button>
        <div className="page-heading"><div><p className="eyebrow">PROJECT · REVISION {selectedProject.graphRevision}</p><h1>{selectedProject.name}</h1><p className="muted">Tasks, dependencies and a live schedule for this project.</p></div>{canManage && <button className="danger-outline" disabled={busy} onClick={async () => {
          if (!session) return; setBusy(true); setError('');
          try { await api.archiveProject(session.accessToken, organization.id, selectedProject.id); setProjects(await api.projects(session.accessToken, organization.id)); setSelectedProject(null); }
          catch (cause) { setError(friendlyError(cause)); } finally { setBusy(false); }
        }}>Archive project</button>}</div>
        {canManage && <form className="project-meta-form" onSubmit={updateProject}><label>Project name<input name="name" defaultValue={selectedProject.name} required maxLength={200} /></label><label>Description<input name="description" defaultValue={selectedProject.description ?? ''} maxLength={20000} /></label><button className="secondary-button" disabled={busy}>Save project details</button></form>}
        {error && <p className="error page-error" role="alert">{error}</p>}
        <div className="project-grid">
          <section className="panel schedule-panel"><div className="panel-head"><div><p className="eyebrow">SCHEDULE ANALYSIS</p><h2>{schedule?.projectDurationHours.toFixed(2) ?? '—'} <small>hours</small></h2></div><span className="revision-pill">Graph r{schedule?.graphRevision ?? selectedProject.graphRevision}</span></div>
            {schedule?.criticalPaths.length ? <><p className="subhead">Critical path</p><div className="path-list">{schedule.criticalPaths.map((path, index) => <p key={index}>{path.map((id) => tasks.find((task) => task.id === id)?.name ?? id).join('  →  ')}</p>)}</div></> : <p className="muted">Add tasks and dependencies to calculate the critical path.</p>}
            {schedule?.isCriticalPathsTruncated && <p className="muted small-note">More critical paths exist than are displayed.</p>}
            <div className="metric-list"><div className="metric-row metric-head"><span>Task</span><span>ES</span><span>EF</span><span>Slack</span></div>{schedule?.taskMetrics.map((metric) => <div className="metric-row" key={metric.taskId}><span>{tasks.find((task) => task.id === metric.taskId)?.name ?? metric.taskId}</span><span>{metric.earlyStartHours.toFixed(1)}</span><span>{metric.earlyFinishHours.toFixed(1)}</span><span className={metric.isCritical ? 'critical-value' : ''}>{metric.totalSlackHours.toFixed(1)}h</span></div>)}</div>
          </section>
          <section className="panel task-create"><p className="eyebrow">NEW WORK ITEM</p><h2>Add a task</h2><form className="stack compact-stack" onSubmit={createTask}>
            <label>Task name<input name="name" required maxLength={240} /></label><label>Description<input name="description" maxLength={20000} /></label>
            <div className="estimate-fields"><label>Optimistic<input name="optimisticHours" type="number" min="0" max="999999.9999" step="0.0001" defaultValue="1" required /></label><label>Likely<input name="likelyHours" type="number" min="0" max="999999.9999" step="0.0001" defaultValue="2" required /></label><label>Pessimistic<input name="pessimisticHours" type="number" min="0" max="999999.9999" step="0.0001" defaultValue="3" required /></label></div>
            <button className="primary" disabled={busy || selectedProject.archivedAt !== null}>Create task</button>
          </form></section>
        </div>
        <section className="panel dependency-panel"><div><p className="eyebrow">DEPENDENCIES</p><h2>Sequence the work</h2></div>{canManage && <form className="dependency-form" onSubmit={addDependency}>
          <select name="prerequisiteTaskId" required defaultValue=""><option value="" disabled>Prerequisite task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select><span>→</span><select name="dependentTaskId" required defaultValue=""><option value="" disabled>Dependent task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select><button className="primary compact" disabled={busy || tasks.length < 2}>Add dependency</button>
        </form>}
          <div className="dependency-list">{dependencies.length ? dependencies.map((edge) => <div className={`dependency-item ${edge.removedAt ? 'removed' : ''}`} key={edge.id}><span>{tasks.find((task) => task.id === edge.prerequisiteTaskId)?.name ?? 'Task'} <b>→</b> {tasks.find((task) => task.id === edge.dependentTaskId)?.name ?? 'Task'}</span><span>{edge.removedAt ? 'Removed' : 'Active'}</span>{canManage && !edge.removedAt && <button className="text-button" onClick={async () => { if (!session || !organization || !selectedProject) return; setBusy(true); try { await api.removeDependency(session.accessToken, organization.id, selectedProject.id, edge.id); await reloadProject(); } catch (cause) { setError(friendlyError(cause)); } finally { setBusy(false); } }}>Remove</button>}</div>) : <p className="muted">No dependency history yet.</p>}</div>
        </section>
        <div className="section-heading"><div><p className="eyebrow">WORK BREAKDOWN</p><h2>Tasks <span className="count-badge">{tasks.length}</span></h2></div><p className="muted">PERT estimates and CPM metrics are calculated from the active graph.</p></div>
        <div className="task-list">{tasks.map((task) => <article className="task-card" key={task.id}>
          <div className="task-title"><span className="task-icon">{task.name.slice(0, 1).toUpperCase()}</span><div><h3>{task.name}</h3><p>Expected {task.expectedHours.toFixed(2)}h · Variance {task.varianceHours.toFixed(3)}h · v{task.version}</p></div>{schedule?.taskMetrics.find((metric) => metric.taskId === task.id)?.isCritical && <span className="critical-badge">CRITICAL</span>}</div>
          <form className="task-edit-form" onSubmit={(event) => void updateTask(event, task)}><label>Name<input name="name" defaultValue={task.name} required maxLength={240} /></label><div className="estimate-fields"><label>O<input name="optimisticHours" type="number" min="0" step="0.0001" defaultValue={task.optimisticHours} required /></label><label>L<input name="likelyHours" type="number" min="0" step="0.0001" defaultValue={task.likelyHours} required /></label><label>P<input name="pessimisticHours" type="number" min="0" step="0.0001" defaultValue={task.pessimisticHours} required /></label></div><button className="secondary-button" disabled={busy}>Save v{task.version + 1}</button>{canManage && <button className="danger-button" type="button" disabled={busy} onClick={() => void deleteTask(task)}>Delete</button>}</form>
          <div className="assignment-row"><div className="assignment-chips">{(assignments[task.id] ?? []).map((assignment) => <span className={`assignment-chip ${assignment.unassignedAt ? 'inactive' : ''}`} key={assignment.id}>{assignment.displayName}{assignment.unassignedAt ? ' · ended' : ''}{canManage && !assignment.unassignedAt && <button aria-label={`Unassign ${assignment.displayName}`} onClick={async () => { if (!session || !organization || !selectedProject) return; setBusy(true); try { await api.unassign(session.accessToken, organization.id, selectedProject.id, task.id, assignment.id); await reloadProject(); } catch (cause) { setError(friendlyError(cause)); } finally { setBusy(false); } }}>×</button>}</span>)}</div>{canManage && members.length > 0 && <form className="assign-form" onSubmit={(event) => void addAssignment(event, task)}><select name="membershipId" required defaultValue=""><option value="" disabled>Assign member…</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.role.toLowerCase()}</option>)}</select><button className="text-button" disabled={busy}>Assign</button></form>}</div>
        </article>)}</div>
        {!tasks.length && <div className="empty-state"><span>◇</span><h3>Your project starts here</h3><p>Add the first task to begin mapping the work and its schedule.</p></div>}
      </> : organization ? <>
        <button className="back-button" onClick={() => { setOrganization(null); setProjects([]); }}>← All organizations</button>
        <div className="page-heading"><div><p className="eyebrow">{organization.role} WORKSPACE</p><h1>{organization.name}</h1><p className="muted">Projects scoped to this organization.</p></div><span className="org-icon large-icon">{organization.name.slice(0, 1).toUpperCase()}</span></div>
        {error && <p className="error page-error" role="alert">{error}</p>}
        <div className="section-heading"><div><p className="eyebrow">DELIVERY PORTFOLIO</p><h2>Projects <span className="count-badge">{projects.length}</span></h2></div>{canManage && <span className="muted">Create and organize project work.</span>}</div>
        <div className="project-cards">{projects.map((project) => <button className="project-card" key={project.id} onClick={() => session && void openProject(project, session.accessToken)}><span className="project-mark">{project.name.slice(0, 1).toUpperCase()}</span><span className="project-info"><strong>{project.name}</strong><small>{project.graphRevision} graph changes · Open project</small></span><span className="arrow">↗</span></button>)}
          {canManage && <form className="project-card create-project-card" onSubmit={createProject}><div className="project-mark plus">+</div><div className="create-fields"><strong>Start a project</strong><input name="name" placeholder="Project name" required maxLength={200} /><input name="description" placeholder="Short description (optional)" maxLength={20000} /><button className="primary compact" disabled={busy}>Create project</button></div></form>}
        </div>
        {!projects.length && !canManage && <div className="empty-state"><span>◇</span><h3>No projects yet</h3><p>An organization manager can create the first project.</p></div>}
      </> : <>
        <p className="eyebrow">YOUR ORGANIZATIONS</p><h1>Choose where to work</h1><p className="muted">Your projects and team activity live inside an organization.</p>
        {error && <p className="error page-error" role="alert">{error}</p>}
        <div className="org-grid">{organizations.map((org) => <button className="org-card org-button" key={org.id} onClick={() => session && void openOrganization(org, session.accessToken)}><div className="org-icon">{org.name.slice(0, 1).toUpperCase()}</div><div><h3>{org.name}</h3><p>{org.slug} · {org.role.toLowerCase()}</p></div><span className="arrow">↗</span></button>)}
          {session && <form className="org-card create-card" onSubmit={createOrganization}><div className="org-icon plus">+</div><div className="create-fields"><h3>Create an organization</h3><input name="name" placeholder="Organization name" required maxLength={160} /><input name="slug" placeholder="unique-slug" required maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" /><button className="primary compact" disabled={busy}>Create workspace</button></div></form>}
        </div>
        <div className="hint"><span>✦</span><p><strong>Your workspace is ready for what’s next.</strong><br />Create a project to organize work and map its delivery schedule.</p></div>
      </>}
    </section>
  </main>;
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') return 'Email or password is incorrect.';
    if (error.code === 'ACCOUNT_ALREADY_EXISTS') return 'An account with this email already exists.';
    if (error.code === 'ORGANIZATION_SLUG_UNAVAILABLE') return 'That organization address is already in use.';
    if (error.code === 'TASK_VERSION_CONFLICT') return 'This task changed elsewhere. Refresh it and try again.';
    if (error.code === 'DEPENDENCY_CYCLE') return 'This dependency would create a cycle.';
    if (error.code === 'DEPENDENCY_EXISTS') return 'That dependency is already active.';
    if (error.code === 'ASSIGNMENT_EXISTS') return 'That member is already assigned to this task.';
    if (error.code === 'PROJECT_ARCHIVED') return 'Archived projects are read-only.';
    if (error.code === 'INVALID_REQUEST' || error.code.startsWith('INVALID_')) return 'Check the entered details and try again.';
    return 'Your request could not be completed. Please try again.';
  }
  return 'Could not reach FlowForge. Check that the API is running and try again.';
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
