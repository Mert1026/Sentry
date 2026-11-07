import React from 'react';
import { Activity, ClipboardList, FlaskConical, Settings2 } from 'lucide-react';

const SECTIONS = [
  { id: 'run', label: 'Run QA', icon: FlaskConical },
  { id: 'findings', label: 'Findings', icon: ClipboardList },
  { id: 'setup', label: 'Setup', icon: Settings2 },
  { id: 'activity', label: 'Activity', icon: Activity },
] as const;

export type ProjectSection = (typeof SECTIONS)[number]['id'];

export function ProjectSections({
  active,
  onChange,
  id,
}: {
  active: ProjectSection;
  onChange: (section: ProjectSection) => void;
  id: string;
}): React.JSX.Element {
  const buttons = React.useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className="project-sections" role="tablist" aria-label="Project sections">
      {SECTIONS.map((section, index) => (
        <button
          key={section.id}
          ref={(button) => {
            buttons.current[index] = button;
          }}
          id={`${id}-tab-${section.id}`}
          role="tab"
          aria-selected={active === section.id}
          aria-controls={`${id}-panel-${section.id}`}
          tabIndex={active === section.id ? 0 : -1}
          onClick={() => onChange(section.id)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === 'ArrowRight') next = (index + 1) % SECTIONS.length;
            else if (event.key === 'ArrowLeft')
              next = (index + SECTIONS.length - 1) % SECTIONS.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = SECTIONS.length - 1;
            else return;
            event.preventDefault();
            onChange(SECTIONS[next]!.id);
            buttons.current[next]?.focus();
          }}
        >
          <section.icon size={16} aria-hidden="true" />
          {section.label}
        </button>
      ))}
    </div>
  );
}

/** Keep each section mounted so switching sections preserves form values and selections. */
export function ProjectSectionPanel({
  section,
  active,
  id,
  children,
}: {
  section: ProjectSection;
  active: ProjectSection;
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="project-section-panel"
      role="tabpanel"
      id={`${id}-panel-${section}`}
      aria-labelledby={`${id}-tab-${section}`}
      hidden={active !== section}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
