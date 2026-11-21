import React from 'react';
import { cv } from './cv';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

// Register a standard font (Helvetica is built-in)
Font.register({
  family: 'Helvetica',
  fonts: [
    { src: 'Helvetica', fontWeight: 400 },
    { src: 'Helvetica-Bold', fontWeight: 700 },
    { src: 'Helvetica-Oblique', fontStyle: 'italic' },
    { src: 'Helvetica-BoldOblique', fontWeight: 700, fontStyle: 'italic' },
  ],
});

const styles = StyleSheet.create({
  page: {
    padding: 48,
    paddingTop: 60,
    paddingBottom: 60,
    fontFamily: 'Helvetica',
    fontSize: 11,
    lineHeight: 1.5,
    color: '#1a1a1a',
  },
  header: {
    textAlign: 'center',
    marginBottom: 8,
    paddingBottom: 16,
  },
  name: {
    fontSize: 26,
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: 8,
  },
  headline: {
    fontSize: 13,
    color: '#555',
    lineHeight: 1.4,
    marginBottom: 4,
  },
  contact: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
    lineHeight: 1.6,
  },
  contactLink: {
    color: '#2563eb',
    textDecoration: 'none',
  },
  section: {
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#333',
    borderBottom: '1px solid #ccc',
    paddingBottom: 4,
    marginBottom: 6,
  },
  summary: {
    fontSize: 11,
    lineHeight: 1.6,
    color: '#333',
    marginBottom: 8,
  },
  roleGroup: {
    marginTop: 16,
  },
  roleGroupTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#555',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  role: {
    marginBottom: 12,
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  roleTitleOrg: {
    fontWeight: 700,
    fontSize: 11,
  },
  rolePeriod: {
    fontSize: 10,
    color: '#666',
    fontStyle: 'italic',
  },
  bullets: {
    marginLeft: 16,
    marginTop: 4,
  },
  bullet: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#333',
    marginBottom: 2,
  },
  educationItem: {
    marginBottom: 8,
  },
  eduTitleOrg: {
    fontWeight: 700,
    fontSize: 11,
  },
  eduPeriod: {
    fontSize: 10,
    color: '#666',
    fontStyle: 'italic',
  },
  certItem: {
    marginBottom: 6,
  },
  certTitleOrg: {
    fontWeight: 700,
    fontSize: 11,
  },
  certPeriod: {
    fontSize: 10,
    color: '#666',
    fontStyle: 'italic',
  },
  skillsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 8,
  },
  skillCategory: {
    width: '45%',
  },
  skillLabel: {
    fontWeight: 700,
    fontSize: 10,
    color: '#555',
    marginBottom: 2,
  },
  skillItems: {
    fontSize: 10,
    color: '#333',
  },
  languages: {
    fontSize: 11,
    color: '#333',
    marginTop: 8,
  },
  // Pagination control styles
  keepTogether: {
    // This view will not break across pages
  },
  roleBlock: {
    // Conservative minimum height to keep role header + first bullet together
    minHeight: 60,
  },
});

/** Role block that keeps header + bullets together on one page */
interface RoleBlockProps {
  role: { title: string; org: string; period: string; bullets: string[] };
}
function RoleBlock({ role }: RoleBlockProps) {
  return (
    <View style={styles.role} wrap={false}>
      <View style={styles.roleHeader}>
        <Text style={styles.roleTitleOrg}>
          {role.title}, {role.org}
        </Text>
        <Text style={styles.rolePeriod}>{role.period}</Text>
      </View>
      <View style={styles.bullets}>
        {role.bullets.map((bullet, i) => (
          <Text key={i} style={styles.bullet}>
            {'\u2022 '}{bullet}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Role group with section title and roles */
interface RoleGroupProps {
  group: typeof cv.experience[0];
}
function RoleGroup({ group }: RoleGroupProps) {
  return (
    <View style={styles.roleGroup} wrap={true}>
      <Text style={styles.roleGroupTitle}>{group.heading}</Text>
      {group.roles.map((role) => (
        <RoleBlock key={`${role.org}-${role.period}`} role={role} />
      ))}
    </View>
  );
}

/** Section wrapper that can force a page break before it */
interface SectionProps {
  title: string;
  children: React.ReactNode;
  breakBefore?: boolean;
}
function Section({ title, children, breakBefore = false }: SectionProps) {
  return (
    <View style={styles.section} wrap={true} break={breakBefore}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** Education section with forced page break before it */
function EducationSection() {
  return (
    <Section title="Education" breakBefore={true}>
      {cv.education.map((edu) => (
        <View key={edu.title} style={styles.educationItem} wrap={false}>
          <Text style={styles.eduTitleOrg}>
            {edu.title}, {edu.org}
          </Text>
          <Text style={styles.eduPeriod}>{edu.period}</Text>
        </View>
      ))}
    </Section>
  );
}

export function CvPdfDocument() {
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap={true}>
        {/* Header - keep together on first page */}
        <View style={styles.header} wrap={false}>
          <Text style={styles.name}>{cv.name}</Text>
          <Text style={styles.headline}>{cv.headline}</Text>
          <Text style={styles.contact}>
            {cv.location}
          </Text>
          <Text style={styles.contact}>
            <Text style={styles.contactLink}>{cv.links.github}</Text>
            <Text style={styles.contactLink}> · </Text>
            <Text style={styles.contactLink}>{cv.links.linkedin}</Text>
            <Text style={styles.contactLink}> · </Text>
            <Text style={styles.contactLink}>{cv.links.email}</Text>
          </Text>
        </View>

        {/* Summary */}
        <Section title="Summary">
          <Text style={styles.summary}>{cv.summary}</Text>
        </Section>

        {/* Experience - each role group wraps, roles kept together */}
        <Section title="Experience">
          {cv.experience.map((group) => (
            <RoleGroup key={group.heading} group={group} />
          ))}
        </Section>

        {/* Education - force page break before it */}
        <EducationSection />

        {/* Certifications */}
        <Section title="Certification">
          {cv.certifications.map((cert) => (
            <View key={cert.title} style={styles.certItem} wrap={false}>
              <Text style={styles.certTitleOrg}>
                {cert.title}, {cert.org}
              </Text>
              <Text style={styles.certPeriod}>{cert.period}</Text>
            </View>
          ))}
        </Section>

        {/* Skills */}
        <Section title="Skills">
          <View style={styles.skillsList} wrap={true}>
            {cv.skills.map((skill) => (
              <View key={skill.label} style={styles.skillCategory} wrap={false}>
                <Text style={styles.skillLabel}>{skill.label}</Text>
                <Text style={styles.skillItems}>{skill.items.join(', ')}</Text>
              </View>
            ))}
          </View>
        </Section>

        {/* Languages */}
        <Section title="Languages">
          <Text style={styles.languages}>{cv.languages}</Text>
        </Section>
      </Page>
    </Document>
  );
}

/** Generate PDF and return a blob URL for download */
export async function generateCvPdfBlob(): Promise<Blob> {
  const { pdf } = await import('@react-pdf/renderer');
  const blob = await pdf(<CvPdfDocument />).toBlob();
  return blob;
}

/** Trigger browser download of the CV PDF */
export async function downloadCvPdf(): Promise<void> {
  try {
    const blob = await generateCvPdfBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Felipe_Berger_CV.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to generate CV PDF:', error);
    throw new Error('Could not generate PDF. Please try again.');
  }
}