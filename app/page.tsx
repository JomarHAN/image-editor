import ImageEditor from '@/app/components/ImageEditor';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Image Editor - Draw & Edit with OpenAI',
  description: 'Upload images, draw mask areas, and edit them using AI. Built with Next.js and OpenAI API.',
  keywords: ['AI', 'image editing', 'OpenAI', 'mask', 'Next.js'],
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-100">
      <ImageEditor />
    </main>
  );
}