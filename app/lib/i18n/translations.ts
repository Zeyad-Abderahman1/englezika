/**
 * Centralized Bilingual Translation Dictionary for Englizeka Platform
 * Arabic (Primary / Default) & English
 */

export type Locale = 'ar' | 'en';

export const translations = {
  ar: {
    // Navigation
    'nav.home': 'الرئيسية',
    'nav.courses': 'الكورسات',
    'nav.about': 'عن المستر',
    'nav.contact': 'تواصل معنا',
    'nav.student_portal': 'مساحتي التعليمية',
    'nav.leaderboard': 'أوائل كل صف',
    'nav.my_account': 'حسابي',
    'nav.login': 'تسجيل الدخول',
    'nav.register': 'حساب جديد',
    'nav.create_account': 'إنشاء حساب',
    'nav.logout': 'تسجيل الخروج',
    'nav.theme_dark': 'تفعيل الوضع الداكن',
    'nav.theme_light': 'تفعيل الوضع الفاتح',
    'nav.menu_open': 'فتح القائمة',
    'nav.menu_close': 'إغلاق القائمة',
    'nav.brand_title': 'Englizeka',
    'nav.brand_subtitle': 'إنجليزيكا',
    'nav.lang_switch': 'English',
    'nav.lang_label': 'اللغة',

    // Home - Hero
    'hero.badge': 'منصة إنجليزي للمرحلة الثانوية',
    'hero.title_prefix': 'مستر',
    'hero.title_name': 'أحمد حسن',
    'hero.promise': 'الإنجليزي ببساطة، من غير حفظ ولا تعقيد',
    'hero.description':
      'مدرس اللغة الإنجليزية للمرحلة الثانوية ومؤسس إنجليزيكا. بيحوّل أصعب القواعد والخطوات لأفكار واضحة، ويدرّبك على شكل الامتحان لحد ما تدخل واثق.',
    'hero.highlight_1': 'شرح من الأساس',
    'hero.highlight_2': 'تطبيق بعد كل حصة',
    'hero.cta_start': 'ابدأ رحلتك',
    'hero.cta_courses': 'شوف الكورسات',
    'hero.assurance': 'شرح منظم · تطبيق مستمر · تقدّم واضح',
    'hero.teacher_alt': 'مستر أحمد حسن',
    'hero.strength_1': 'شرح بسيط ومنظم',
    'hero.strength_2': 'تدريب على نظام الامتحان',
    'hero.strength_3': 'متابعة مستمرة',

    // Home - Features / Why Section
    'why.badge': 'ليه إنجليزيكا؟',
    'why.title': 'طريقة تعلم مصممة لنتائج حقيقية',
    'why.subtitle': 'مش مجرد فيديوهات مسجلة، دي تجربة تعليمية متكاملة تضمن فهمك وتفوقك.',
    'feature.1.title': 'شرح مبسط وعميق',
    'feature.1.desc': 'تفكيك أصعب القواعد والكلمات لخطوات منطقية وسهلة الحفظ والتطبيق.',
    'feature.2.title': 'تدريب مستمر وامتحانات',
    'feature.2.desc': 'امتحانات دورية إلكترونية بنظام الثانوية العامة الجديد مع تصحيح فوري.',
    'feature.3.title': 'متابعة وتقييم أداء',
    'feature.3.desc': 'لوحة تحكم للطالب لمتابعة نسبة الإنجاز والدرجات ونقاط القوة والضعف.',
    'feature.4.title': 'محتوى متاح ٢٤/٧',
    'feature.4.desc': 'شاهد الحصص وحل الواجبات في أي وقت يناسب جدولك الدراسي.',

    // Home - Stats
    'stats.students': '+٥٠٠٠ طالب',
    'stats.students_label': 'اتعلموا وتفوقوا معنا',
    'stats.lectures': '+١٠٠ حصة',
    'stats.lectures_label': 'شرح وحل تفاعلي',
    'stats.grades': '٣ صفوف',
    'stats.grades_label': 'الأول والثاني والثالث الثانوي',
    'stats.success': '٩٨٪',
    'stats.success_label': 'نسبة رضا الطلاب',

    // Home - Featured Courses
    'featured.badge': 'الكورسات المتاحة',
    'featured.title': 'اختار خطتك للعام الدراسي',
    'featured.subtitle': 'مناهج متكاملة لكل صف دراسي تشمل الشرح، الواجبات، والامتحانات.',
    'featured.view_all': 'عرض كل الكورسات',

    // Home - Testimonials
    'testimonials.badge': 'آراء الطلاب',
    'testimonials.title': 'قصص نجاح من طلاب إنجليزيكا',
    'testimonials.subtitle': 'تجربة طلابنا في الثانوية العامة مع مستر أحمد حسن.',

    // Home - CTA
    'cta.title': 'جاهز تقفل امتحان الإنجليزي؟',
    'cta.subtitle': 'انضم لآلاف الطلاب اللي بيتعلموا بذكاء وثقة مع مستر أحمد حسن.',
    'cta.button': 'أنشئ حسابك الآن مجاناً',

    // Courses Page
    'courses.hero_badge': 'اختار خطتك',
    'courses.hero_title': 'كل كورسات إنجليزيكا',
    'courses.hero_subtitle': 'محتوى مرتب لكل صف، من الشرح للتدريب والمراجعة.',
    'courses.filter_all': 'الكل',
    'courses.filter_g1': 'أولى ثانوي',
    'courses.filter_g2': 'تانية ثانوي',
    'courses.filter_g3': 'تالتة ثانوي',
    'courses.loading': 'جاري تحميل الكورسات...',
    'courses.empty_title': 'لا توجد كورسات متاحة حالياً',
    'courses.empty_desc': 'سيتم إضافة الكورسات الجديدة قريباً.',
    'courses.empty_filter_title': 'لا توجد كورسات متاحة لهذا الصف حالياً',
    'courses.empty_filter_desc': 'جرب اختيار صف دراسي آخر أو تصفح كل الكورسات.',
    'courses.lectures_count': 'محاضرات',
    'courses.subscribe_now': 'اشترك الآن',
    'courses.details': 'تفاصيل الكورس',
    'courses.currency': 'ج.م',
    'courses.free': 'مجاناً',

    // About Page
    'about.hero_badge': 'عن المستر',
    'about.hero_title': 'مستر أحمد حسن',
    'about.hero_subtitle': 'معلم اللغة الإنجليزية وخبير مناهج الثانوية العامة.',
    'about.bio_title': 'رحلة شغف في تدريس الإنجليزية',
    'about.bio_p1':
      'على مدار أكثر من ١٠ سنوات، ساعد مستر أحمد حسن آلاف الطلاب في مختلف محافظات مصر على كسر حاجز الخوف من مادة اللغة الإنجليزية والوصول لأعلى الدرجات في الثانوية العامة.',
    'about.bio_p2':
      'تعتمد فلسفته على الفهم والتطبيق العملي بدلاً من الحفظ الأعمى، مع التركيز على مهارات التفكير النقدي وأساليب حل الامتحانات الحديثة.',
    'about.social_title': 'تواصل مع المستر على المنصات',

    // Contact Page
    'contact.hero_badge': 'تواصل معنا',
    'contact.hero_title': 'إحنا هنا لمساعدتك',
    'contact.hero_subtitle': 'عندك سؤال أو استفسار بخصوص الكورسات والاشتراك؟ فريق الدعم متاح ٢٤/٧.',
    'contact.whatsapp_title': 'واتساب الدعم الفني',
    'contact.whatsapp_desc': 'أسرع طريقة للتواصل المباشر مع فريق الدعم الفني والمبيعات.',
    'contact.whatsapp_btn': 'محادثة عبر واتساب',
    'contact.phone_title': 'الاتصال الهاتفي',
    'contact.email_title': 'البريد الإلكتروني',

    // Auth Pages
    'auth.login_title': 'تسجيل الدخول',
    'auth.login_subtitle': 'أهلاً بك مجدداً في منصة إنجليزيكا',
    'auth.register_title': 'إنشاء حساب جديد',
    'auth.register_subtitle': 'ابدأ رحلة التفوق في اللغة الإنجليزية الآن',
    'auth.email': 'البريد الإلكتروني',
    'auth.email_placeholder': 'name@example.com',
    'auth.password': 'كلمة المرور',
    'auth.password_placeholder': '••••••••••••',
    'auth.full_name': 'الاسم بالكامل',
    'auth.full_name_placeholder': 'الاسم ثلاثي أو رباعي',
    'auth.phone': 'رقم الهاتف (واتساب)',
    'auth.phone_placeholder': '01XXXXXXXXX',
    'auth.parent_phone': 'رقم هاتف ولي الأمر',
    'auth.grade': 'الصف الدراسي',
    'auth.grade_select': 'اختر الصف الدراسي',
    'auth.grade_1': 'الصف الأول الثانوي',
    'auth.grade_2': 'الصف الثاني الثانوي',
    'auth.grade_3': 'الصف الثالث الثانوي',
    'auth.gov': 'المحافظة',
    'auth.gov_select': 'اختر المحافظة',
    'auth.remember_me': 'البقاء مسجلاً للدخول',
    'auth.remember_me_hint': 'احفظ الجلسة على هذا الجهاز لتسجيل دخول أسرع',
    'auth.forgot_password': 'نسيت كلمة المرور؟',
    'auth.submit_login': 'دخول إلى حسابي',
    'auth.submit_register': 'إنشاء الحساب والمتابعة',
    'auth.no_account': 'ليس لديك حساب بعد؟',
    'auth.has_account': 'لديك حساب بالفعل؟',
    'auth.register_link': 'أنشئ حساباً جديداً',
    'auth.login_link': 'سجل الدخول الآن',
    'auth.verification_sent': 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.',
    'auth.verify_title': 'تأكيد البريد الإلكتروني',
    'auth.verify_subtitle': 'أدخل الرمز المكون من ٦ أرقام المرسل إلى',
    'auth.verify_code': 'رمز التحقق',
    'auth.verify_submit': 'تأكيد الرمز والدخول',
    'auth.resend_code': 'إعادة إرسال الرمز',

    // Student Portal
    'student.welcome': 'مرحباً',
    'student.dashboard': 'لوحة التحكم',
    'student.enrolled_courses': 'كورساتي المشترك بها',
    'student.available_courses': 'الكورسات المتاحة',
    'student.exams': 'الامتحانات والواجبات',
    'student.progress': 'نسبة التقدم',
    'student.continue_learning': 'متابعة التعلم',
    'student.view_results': 'عرض النتائج',
    'student.no_enrolled': 'لست مشتركاً في أي كورس حالياً.',

    // Footer
    'footer.description': 'منصة تعليمية متخصصة في اللغة الإنجليزية لطلاب المرحلة الثانوية العامة.',
    'footer.quick_links': 'روابط سريعة',
    'footer.support': 'الدعم والمساعدة',
    'footer.privacy': 'سياسة الخصوصية',
    'footer.terms': 'الشروط والأحكام',
    'footer.rights': 'جميع الحقوق محفوظة © إنجليزيكا',
    'footer.teacher_name': 'مستر أحمد حسن',

    // Cookie Consent
    'cookie.text': 'نستخدم ملفات تعريف الارتباط الأساسية لضمان عمل المنصة وحفظ تفضيلاتك.',
    'cookie.accept': 'موافق',
    'cookie.decline': 'إلغاء',

    // Common UI
    'ui.loading': 'جاري التحميل...',
    'ui.back': 'رجوع',
    'ui.next': 'التالي',
    'ui.close': 'إغلاق',
    'ui.save': 'حفظ',
    'ui.error': 'حدث خطأ ما',
    'ui.retry': 'إعادة المحاولة',
  },

  en: {
    // Navigation
    'nav.home': 'Home',
    'nav.courses': 'Courses',
    'nav.about': 'About Teacher',
    'nav.contact': 'Contact Us',
    'nav.student_portal': 'My Learning Space',
    'nav.leaderboard': 'Top Students',
    'nav.my_account': 'My Account',
    'nav.login': 'Sign In',
    'nav.register': 'Sign Up',
    'nav.create_account': 'Create Account',
    'nav.logout': 'Sign Out',
    'nav.theme_dark': 'Enable Dark Mode',
    'nav.theme_light': 'Enable Light Mode',
    'nav.menu_open': 'Open Menu',
    'nav.menu_close': 'Close Menu',
    'nav.brand_title': 'Englizeka',
    'nav.brand_subtitle': 'English Platform',
    'nav.lang_switch': 'العربية',
    'nav.lang_label': 'Language',

    // Home - Hero
    'hero.badge': 'Secondary Stage English Platform',
    'hero.title_prefix': 'Mr.',
    'hero.title_name': 'Ahmed Hassan',
    'hero.promise': 'English made simple — clear, structured, and easy to master',
    'hero.description':
      'Senior High School English teacher and founder of Englizeka. Transforming complex grammar and vocabulary into crystal-clear concepts with exam-targeted practice.',
    'hero.highlight_1': 'From Foundation Up',
    'hero.highlight_2': 'Post-Lesson Practice',
    'hero.cta_start': 'Start Your Journey',
    'hero.cta_courses': 'Explore Courses',
    'hero.assurance': 'Structured Lessons · Continuous Practice · Measurable Progress',
    'hero.teacher_alt': 'Mr. Ahmed Hassan',
    'hero.strength_1': 'Clear & Structured',
    'hero.strength_2': 'Exam-Targeted Practice',
    'hero.strength_3': 'Continuous Follow-Up',

    // Home - Features / Why Section
    'why.badge': 'Why Englizeka?',
    'why.title': 'A Learning System Built for Real Results',
    'why.subtitle': 'Not just recorded videos, but an integrated learning experience ensuring full mastery.',
    'feature.1.title': 'Deep & Simplified Explanations',
    'feature.1.desc': 'Deconstructing the hardest grammar and vocabulary into logical, easy-to-apply steps.',
    'feature.2.title': 'Continuous Quizzes & Exams',
    'feature.2.desc': 'Periodic online exams following the modern high school exam system with instant feedback.',
    'feature.3.title': 'Performance Analytics',
    'feature.3.desc': 'Personal dashboard to track completion rate, quiz scores, strengths, and areas to improve.',
    'feature.4.title': '24/7 Available Content',
    'feature.4.desc': 'Watch lectures and complete assignments anytime that fits your study schedule.',

    // Home - Stats
    'stats.students': '+5,000 Students',
    'stats.students_label': 'Learned and excelled with us',
    'stats.lectures': '+100 Lectures',
    'stats.lectures_label': 'Interactive explanation and solving',
    'stats.grades': '3 Grades',
    'stats.grades_label': '1st, 2nd, and 3rd Secondary',
    'stats.success': '98%',
    'stats.success_label': 'Student satisfaction rate',

    // Home - Featured Courses
    'featured.badge': 'Available Courses',
    'featured.title': 'Choose Your Plan for the Academic Year',
    'featured.subtitle': 'Comprehensive curriculum for each grade including lectures, homework, and exams.',
    'featured.view_all': 'View All Courses',

    // Home - Testimonials
    'testimonials.badge': 'Student Reviews',
    'testimonials.title': 'Success Stories from Englizeka Students',
    'testimonials.subtitle': 'Real experiences from our students with Mr. Ahmed Hassan.',

    // Home - CTA
    'cta.title': 'Ready to Ace Your English Exam?',
    'cta.subtitle': 'Join thousands of students learning smartly and confidently with Mr. Ahmed Hassan.',
    'cta.button': 'Create Free Account Now',

    // Courses Page
    'courses.hero_badge': 'Choose Your Plan',
    'courses.hero_title': 'All Englizeka Courses',
    'courses.hero_subtitle': 'Organized content for each secondary grade, from explanation to practice and revision.',
    'courses.filter_all': 'All',
    'courses.filter_g1': '1st Secondary',
    'courses.filter_g2': '2nd Secondary',
    'courses.filter_g3': '3rd Secondary',
    'courses.loading': 'Loading courses...',
    'courses.empty_title': 'No courses available right now',
    'courses.empty_desc': 'New courses will be published soon.',
    'courses.empty_filter_title': 'No courses available for this grade right now',
    'courses.empty_filter_desc': 'Try selecting another grade or view all courses.',
    'courses.lectures_count': 'Lectures',
    'courses.subscribe_now': 'Subscribe Now',
    'courses.details': 'Course Details',
    'courses.currency': 'EGP',
    'courses.free': 'Free',

    // About Page
    'about.hero_badge': 'About Teacher',
    'about.hero_title': 'Mr. Ahmed Hassan',
    'about.hero_subtitle': 'Senior English Teacher & High School Curriculum Expert.',
    'about.bio_title': 'A Passionate Journey in English Teaching',
    'about.bio_p1':
      'For over 10 years, Mr. Ahmed Hassan has helped thousands of students across Egypt overcome their fear of English and achieve top scores in the General Secondary Certificate (Thanaweya Amma).',
    'about.bio_p2':
      'His teaching philosophy focuses on deep conceptual understanding and practical application over rote memorization, honing critical thinking and exam-solving techniques.',
    'about.social_title': 'Connect with the Teacher on Social Media',

    // Contact Page
    'contact.hero_badge': 'Contact Us',
    'contact.hero_title': 'We Are Here to Help',
    'contact.hero_subtitle': 'Have a question regarding courses or subscription? Our support team is available 24/7.',
    'contact.whatsapp_title': 'WhatsApp Support',
    'contact.whatsapp_desc': 'The fastest way to reach our support and sales team directly.',
    'contact.whatsapp_btn': 'Chat on WhatsApp',
    'contact.phone_title': 'Phone Call',
    'contact.email_title': 'Email Address',

    // Auth Pages
    'auth.login_title': 'Sign In',
    'auth.login_subtitle': 'Welcome back to Englizeka Platform',
    'auth.register_title': 'Create New Account',
    'auth.register_subtitle': 'Start your journey to English excellence now',
    'auth.email': 'Email Address',
    'auth.email_placeholder': 'name@example.com',
    'auth.password': 'Password',
    'auth.password_placeholder': '••••••••••••',
    'auth.full_name': 'Full Name',
    'auth.full_name_placeholder': 'Enter your full name',
    'auth.phone': 'Phone Number (WhatsApp)',
    'auth.phone_placeholder': '01XXXXXXXXX',
    'auth.parent_phone': 'Parent Phone Number',
    'auth.grade': 'Academic Grade',
    'auth.grade_select': 'Select Academic Grade',
    'auth.grade_1': '1st Secondary Grade',
    'auth.grade_2': '2nd Secondary Grade',
    'auth.grade_3': '3rd Secondary Grade',
    'auth.gov': 'Governorate',
    'auth.gov_select': 'Select Governorate',
    'auth.remember_me': 'Stay Signed In',
    'auth.remember_me_hint': 'Keep your session active on this device for faster login',
    'auth.forgot_password': 'Forgot Password?',
    'auth.submit_login': 'Sign In to My Account',
    'auth.submit_register': 'Create Account & Continue',
    'auth.no_account': "Don't have an account yet?",
    'auth.has_account': 'Already have an account?',
    'auth.register_link': 'Create a new account',
    'auth.login_link': 'Sign in now',
    'auth.verification_sent': 'Verification code sent to your email address.',
    'auth.verify_title': 'Verify Your Email',
    'auth.verify_subtitle': 'Enter the 6-digit code sent to',
    'auth.verify_code': 'Verification Code',
    'auth.verify_submit': 'Verify Code & Sign In',
    'auth.resend_code': 'Resend Code',

    // Student Portal
    'student.welcome': 'Welcome',
    'student.dashboard': 'Dashboard',
    'student.enrolled_courses': 'My Enrolled Courses',
    'student.available_courses': 'Available Courses',
    'student.exams': 'Exams & Quizzes',
    'student.progress': 'Progress Rate',
    'student.continue_learning': 'Continue Learning',
    'student.view_results': 'View Results',
    'student.no_enrolled': 'You are not enrolled in any course currently.',

    // Footer
    'footer.description': 'Educational platform specialized in English for High School students.',
    'footer.quick_links': 'Quick Links',
    'footer.support': 'Help & Support',
    'footer.privacy': 'Privacy Policy',
    'footer.terms': 'Terms & Conditions',
    'footer.rights': 'All rights reserved © Englizeka',
    'footer.teacher_name': 'Mr. Ahmed Hassan',

    // Cookie Consent
    'cookie.text': 'We use essential cookies to ensure the platform functions properly and save your preferences.',
    'cookie.accept': 'Accept',
    'cookie.decline': 'Decline',

    // Common UI
    'ui.loading': 'Loading...',
    'ui.back': 'Back',
    'ui.next': 'Next',
    'ui.close': 'Close',
    'ui.save': 'Save',
    'ui.error': 'Something went wrong',
    'ui.retry': 'Retry',
  },
} as const;

export type TranslationKey = keyof typeof translations.ar;
