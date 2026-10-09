import type { Metadata } from 'next'
import Link from 'next/link'
import { ProsePage, P, H3 } from '@/components/marketing/Marketing'

export const metadata: Metadata = {
  title: 'About... Omniply',
  description: 'The company behind Omniply.',
}

export default function AboutPage() {
  return (
    <ProsePage title="About Omniply">
      <P lead>
        Omniply is built on sixteen years of running marketing for
        health professionals and local practices.
      </P>
      <P>
        The system inside Omniply is the playbook elite practice coaches teach their clients to execute by
        hand: instant response to every inquiry, compounding Google reviews, consistent content in your
        voice, and systematic patient recall... the same signals that now decide whether AI assistants can
        find and recommend a practice at all. It works every time it is actually executed, and it fails
        every time life gets in the way of executing it. So we built the version that cannot get tired,
        cannot get busy, and cannot skip a week.
      </P>
      <H3>We run our own marketing on Omniply</H3>
      <P>
        Every article in <Link href="/articles" className="underline">our articles section</Link> is
        researched, written, illustrated, and published by the same engine your practice gets... same
        pipeline, same review flow, same voice matching. We would not sell an autopilot we do not fly
        ourselves.
      </P>
      <H3>Contact</H3>
      <P>
        <a href="mailto:support@omniply.io" className="underline">support@omniply.io</a> &middot; or use the{' '}
        <a href="/contact" className="underline">contact form</a>.
      </P>
    </ProsePage>
  )
}
