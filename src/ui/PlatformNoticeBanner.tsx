export function PlatformNoticeBanner({ notice }: { notice: string }) {
  if (!notice) return null;
  return (
    <div
      role="alert"
      data-testid="platform-notice"
      className="border-b border-amber-400 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      {notice}
    </div>
  );
}
