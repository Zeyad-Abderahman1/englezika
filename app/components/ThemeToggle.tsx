'use client';

import styles from './ThemeToggle.module.css';

interface ThemeToggleProps {
  isDark: boolean;
  onToggle: () => void;
  className?: string;
}

export default function ThemeToggle({ isDark, onToggle, className = '' }: ThemeToggleProps) {
  const label = isDark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن';

  return (
    <button
      type="button"
      className={`${styles.toggle} ${className} theme-toggle`}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span className={`${styles.toggleContent} toggle-content`}>
        {/* Clouds Back Layer */}
        <svg
          aria-hidden="true"
          className={`${styles.backdropSvg} ${styles.clouds} ${styles.cloudsBack}`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 290 228"
          preserveAspectRatio="none"
        >
          <g>
            <path
              fill="#fcd5df"
              d="M335 147.5c0 27.89-22.61 50.5-50.5 50.5a50.78 50.78 0 0 1-9.29-.853c-2.478 12.606-10.595 23.188-21.615 29.011C245.699 243.749 228.03 256 207.5 256a50.433 50.433 0 0 1-16.034-2.599A41.811 41.811 0 0 1 166 262a41.798 41.798 0 0 1-22.893-6.782A42.21 42.21 0 0 1 135 256a41.82 41.82 0 0 1-19.115-4.592A41.84 41.84 0 0 1 88 262c-1.827 0-3.626-.117-5.391-.343C74.911 270.448 63.604 276 51 276c-23.196 0-42-18.804-42-42s18.804-42 42-42c1.827 0 3.626.117 5.391.343C64.089 183.552 75.396 178 88 178a41.819 41.819 0 0 1 19.115 4.592C114.532 176.002 124.298 172 135 172a41.798 41.798 0 0 1 22.893 6.782 42.066 42.066 0 0 1 7.239-.773C174.137 164.159 189.749 155 207.5 155c.601 0 1.199.01 1.794.031A41.813 41.813 0 0 1 234 147h.002c.269-27.66 22.774-50 50.498-50 27.89 0 50.5 22.61 50.5 50.5Z"
            />
          </g>
        </svg>

        {/* Clouds Front Layer */}
        <svg
          aria-hidden="true"
          className={`${styles.backdropSvg} ${styles.clouds}`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 290 228"
          preserveAspectRatio="none"
        >
          <g>
            <path
              fill="#ffffff"
              d="M328 167.5c0 15.214-7.994 28.56-20.01 36.068.007.31.01.621.01.932 0 23.472-19.028 42.5-42.5 42.5-3.789 0-7.461-.496-10.957-1.426C249.671 263.676 233.141 277 213.5 277a42.77 42.77 0 0 1-7.702-.696C198.089 284.141 187.362 289 175.5 289a42.338 42.338 0 0 1-27.864-10.408A42.411 42.411 0 0 1 133.5 281c-4.36 0-8.566-.656-12.526-1.876C113.252 287.066 102.452 292 90.5 292a42.388 42.388 0 0 1-15.8-3.034A42.316 42.316 0 0 1 48.5 298C25.028 298 6 278.972 6 255.5S25.028 213 48.5 213a42.388 42.388 0 0 1 15.8 3.034A42.316 42.316 0 0 1 90.5 207c4.36 0 8.566.656 12.526 1.876C110.748 200.934 121.548 196 133.5 196a42.338 42.338 0 0 1 27.864 10.408A42.411 42.411 0 0 1 175.5 204c2.63 0 5.204.239 7.702.696C190.911 196.859 201.638 192 213.5 192c3.789 0 7.461.496 10.957 1.426 2.824-10.491 9.562-19.377 18.553-24.994-.007-.31-.01-.621-.01-.932 0-23.472 19.028-42.5 42.5-42.5s42.5 19.028 42.5 42.5Z"
            />
          </g>
        </svg>

        {/* Stars Layer */}
        <svg
          aria-hidden="true"
          className={`${styles.backdropSvg} ${styles.stars}`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 290 228"
          preserveAspectRatio="none"
        >
          <g>
            <g className={styles.starItem1}>
              <path
                fill="#ffffff"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M61 11.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.749 3.749 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.749 3.749 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813a3.749 3.749 0 0 0 2.576-2.576l.813-2.846A.75.75 0 0 1 61 11.5Z"
              />
            </g>
            <g className={styles.starItem2}>
              <path
                fill="#ffffff"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M62.5 45.219a.329.329 0 0 1 .315.238l.356 1.245a1.641 1.641 0 0 0 1.127 1.127l1.245.356a.328.328 0 0 1 0 .63l-1.245.356a1.641 1.641 0 0 0-1.127 1.127l-.356 1.245a.328.328 0 0 1-.63 0l-.356-1.245a1.641 1.641 0 0 0-1.127-1.127l-1.245-.356a.328.328 0 0 1 0-.63l1.245-.356a1.641 1.641 0 0 0 1.127-1.127l.356-1.245a.328.328 0 0 1 .315-.238Z"
              />
            </g>
            <g className={styles.starItem3}>
              <path
                fill="#ffffff"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M32 31.188a.28.28 0 0 1 .27.204l.305 1.067a1.405 1.405 0 0 0 .966.966l1.068.305a.28.28 0 0 1 0 .54l-1.068.305a1.405 1.405 0 0 0-.966.966l-.305 1.068a.28.28 0 0 1-.54 0l-.305-1.068a1.406 1.406 0 0 0-.966-.966l-1.067-.305a.28.28 0 0 1 0-.54l1.067-.305a1.406 1.406 0 0 0 .966-.966l.305-1.068a.281.281 0 0 1 .27-.203Z"
              />
            </g>
            <g className={styles.starItem4}>
              <path
                fill="#ffffff"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M125.5 76.344a.513.513 0 0 1 .496.374l.559 1.956a2.574 2.574 0 0 0 1.771 1.771l1.956.56a.514.514 0 0 1 .27.805.514.514 0 0 1-.27.186l-1.956.559a2.57 2.57 0 0 0-1.771 1.77l-.559 1.957a.514.514 0 0 1-.806.27.514.514 0 0 1-.186-.27l-.559-1.956a2.574 2.574 0 0 0-1.771-1.771l-1.956-.56a.514.514 0 0 1-.27-.805.514.514 0 0 1 .27-.186l1.956-.559a2.57 2.57 0 0 0 1.771-1.77l.559-1.957a.515.515 0 0 1 .496-.374Z"
              />
            </g>
          </g>
        </svg>

        {/* Indicator Wrapper & Celestial Body */}
        <span className={styles.indicatorWrapper}>
          <span className={styles.indicator}>
            {/* Sun Body */}
            <span className={styles.sun} aria-hidden="true" />
            {/* Moon Body with Craters */}
            <span className={styles.moon} aria-hidden="true">
              <span className={`${styles.crater} ${styles.crater1}`} />
              <span className={`${styles.crater} ${styles.crater2}`} />
              <span className={`${styles.crater} ${styles.crater3}`} />
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
