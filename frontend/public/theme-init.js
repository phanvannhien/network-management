// Apply the saved theme/density before first paint (no light flash in dark mode); see src/lib/preferences.ts.
try {
  var t = localStorage.getItem('ntb-theme')
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark')
  document.documentElement.dataset.density =
    localStorage.getItem('ntb-density') === 'comfortable' ? 'comfortable' : 'compact'
} catch {
  // storage disabled: defaults apply
}
