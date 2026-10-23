import { notFound } from 'next/navigation';
import { DesignPreview } from './preview';
export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.DESIGN_PREVIEW !== '1') notFound();
  return <DesignPreview />;
}
