import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

/**
 * One superfamily, two voices.
 *
 * The room already set every number, id and path in IBM Plex Mono. Prose was
 * the system stack — whatever the OS happened to supply — which meant the two
 * halves of the interface had no relationship to each other. Plex Sans shares
 * the mono's skeleton and none of its rhythm, so the pairing reads as one
 * design while keeping the distinction that matters here:
 *
 *   mono = a machine reported this   ·   sans = someone is talking
 *
 * That rule is why a sha, a branch and a duration are all mono, and why no
 * label has to say so.
 */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Aftershock',
  description: 'Autonomous QA and repair for every commit.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
