import { cv } from './cv';
import { downloadCvPdf } from './CvPdf';

export default function CvView() {
  const handleDownload = async () => {
    try {
      await downloadCvPdf();
    } catch {
      alert("Sorry, couldn't generate the PDF. Try again?");
    }
  };

  return (
    <article className="cv" aria-label={`${cv.name}'s CV`}>
      <header className="cv-head">
        <h2>{cv.name}</h2>
        <p>{cv.headline}</p>
        <p className="cv-contact">
          {cv.location}
          <br />
          <a href={cv.links.github} target="_blank" rel="noreferrer">GitHub</a>{' '}
          <a href={cv.links.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>{' '}
          <a href={`mailto:${cv.links.email}`}>Email</a>
        </p>
        <button className="cv-download" onClick={handleDownload} type="button">
          Download PDF
        </button>
      </header>

      <section>
        <h3>Summary</h3>
        <p>{cv.summary}</p>
      </section>

      {cv.experience.map((group) => (
        <section key={group.heading}>
          <h3>{group.heading}</h3>
          {group.roles.map((r) => (
            <div className="cv-item" key={`${r.org}-${r.period}`}>
              <div className="cv-row">
                <p>
                  <strong>{r.title}</strong>, {r.org}
                </p>
                <span>{r.period}</span>
              </div>
              <ul>
                {r.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}

      <section>
        <h3>Education</h3>
        {cv.education.map((e) => (
          <div className="cv-row cv-item" key={e.title}>
            <p>
              <strong>{e.title}</strong>, {e.org}
            </p>
            <span>{e.period}</span>
          </div>
        ))}
      </section>

      <section>
        <h3>Certification</h3>
        {cv.certifications.map((c) => (
          <div className="cv-row cv-item" key={c.title}>
            <p>
              <strong>{c.title}</strong>, {c.org}
            </p>
            <span>{c.period}</span>
          </div>
        ))}
      </section>

      <section>
        <h3>Skills</h3>
        <dl className="cv-skills">
          {cv.skills.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.items.join(', ')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3>Languages</h3>
        <p>{cv.languages}</p>
      </section>
    </article>
  );
}