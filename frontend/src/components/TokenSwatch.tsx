/**
 * TokenSwatch - A simple component to demonstrate design tokens
 * Used for visual verification and testing that CSS variables apply correctly
 */
export function TokenSwatch() {
  return (
    <div
      data-testid="token-swatch"
      style={{
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-default)',
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--text-md)',
      }}
    >
      <h2
        style={{
          fontSize: 'var(--text-lg)',
          marginBottom: 'var(--space-2)',
          color: 'var(--text-accent)',
        }}
      >
        Design Token Demo
      </h2>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          flexWrap: 'wrap',
        }}
      >
        {[
          'luxor',
          'tower',
          'american',
          'festival',
          'worldwide',
          'continental',
          'imperial',
        ].map((chain) => (
          <span
            key={chain}
            data-testid={`chain-${chain}`}
            style={{
              backgroundColor: `var(--chain-${chain})`,
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-sm)',
              textTransform: 'uppercase',
            }}
          >
            {chain}
          </span>
        ))}
      </div>
    </div>
  )
}
