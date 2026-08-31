/**
 * Public site configuration and teacher contact information for Englizeka.
 * Note: These are public-facing details, not secrets.
 */

export const SITE_CONFIG = {
  name: 'Englizeka',
  nameArabic: 'إنجليزيكا',
  tagline: 'افهم الإنجليزي وخليه نقطة قوتك',
  email: 'info@englezika.com',
  teacher: {
    name: 'Mr Ahmed Hassan',
    nameArabic: 'مستر أحمد حسن',
    roleArabic: 'مدرس اللغة الإنجليزية للمرحلة الثانوية',
    phoneDisplay: '+20 12 29997047',
    phoneHref: 'tel:+201229997047',
    whatsapp: 'https://wa.me/201229997047',
    youtube:
      'https://www.youtube.com/@%D8%A7%D8%AD%D9%85%D8%AF%D8%AD%D8%B3%D9%86-%D9%8A5%D8%BA9%D9%86',
    tiktok: 'https://www.tiktok.com/@mr.ahmedhassanenglezy',
  },
  socialLinks: [
    {
      id: 'whatsapp',
      name: 'واتساب',
      nameEn: 'WhatsApp',
      href: 'https://wa.me/201229997047',
      ariaLabel: 'تواصل مع مستر أحمد حسن عبر واتساب',
      external: true,
    },
    {
      id: 'phone',
      name: 'اتصل بنا',
      nameEn: 'Phone',
      href: 'tel:+201229997047',
      display: '+20 12 29997047',
      ariaLabel: 'اتصال هاتفي بمستر أحمد حسن',
      external: false,
    },
    {
      id: 'youtube',
      name: 'يوتيوب',
      nameEn: 'YouTube',
      href: 'https://www.youtube.com/@%D8%A7%D8%AD%D9%85%D8%AF%D8%AD%D8%B3%D9%86-%D9%8A5%D8%BA9%D9%86',
      ariaLabel: 'قناة مستر أحمد حسن الرسمية على يوتيوب',
      external: true,
    },
    {
      id: 'tiktok',
      name: 'تيك توك',
      nameEn: 'TikTok',
      href: 'https://www.tiktok.com/@mr.ahmedhassanenglezy',
      ariaLabel: 'حساب مستر أحمد حسن على تيك توك',
      external: true,
    },
  ],
} as const;

export type SiteConfig = typeof SITE_CONFIG;
