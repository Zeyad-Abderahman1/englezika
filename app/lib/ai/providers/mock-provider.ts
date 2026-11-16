import { ProviderError } from '../ai-provider';
import type {
  AiProvider,
  LocalAiProvider,
  GenerateStructuredOutputOptions,
  StructuredOutputResult,
  PlanResult,
  ProviderHealthResult,
  ProviderRequestOptions,
} from '../ai-provider';

export type MockProviderMode =
  | 'success'
  | 'invalid_response'
  | 'offline'
  | 'timeout'
  | 'slow';

export interface MockProviderConfig {
  mode?: MockProviderMode;
  model?: string;
  mockData?: unknown;
  mockPlan?: PlanResult;
  mockPlans?: PlanResult[];
  planHandler?: (prompt: string, context?: unknown) => PlanResult | Promise<PlanResult>;
  structuredOutputHandler?: <T = unknown>(options: GenerateStructuredOutputOptions<T>) => StructuredOutputResult<T> | Promise<StructuredOutputResult<T>>;
  latencyMs?: number;
  healthy?: boolean;
}

export class MockAiProvider implements LocalAiProvider {
  readonly name = 'mock';
  model: string;
  mode: MockProviderMode;
  mockData: unknown;
  mockPlan: PlanResult;
  mockPlans: PlanResult[];
  planHandler?: (prompt: string, context?: unknown) => PlanResult | Promise<PlanResult>;
  structuredOutputHandler?: <T = unknown>(options: GenerateStructuredOutputOptions<T>) => StructuredOutputResult<T> | Promise<StructuredOutputResult<T>>;
  latencyMs: number;
  healthy: boolean;

  constructor(config: MockProviderConfig = {}) {
    this.model = config.model || 'mock-model-v1';
    this.mode = config.mode || 'success';
    this.mockData = config.mockData ?? { status: 'mock_success', items: [] };
    this.mockPlan = config.mockPlan ?? {
      planText: 'Mock educational plan',
      actions: [],
      explanation: 'This is a deterministic test plan.',
    };
    this.mockPlans = config.mockPlans ? [...config.mockPlans] : [];
    this.planHandler = config.planHandler;
    this.structuredOutputHandler = config.structuredOutputHandler;
    this.latencyMs = config.latencyMs ?? 0;
    this.healthy = config.healthy ?? true;
  }

  setMode(mode: MockProviderMode) {
    this.mode = mode;
  }

  setMockData(data: unknown) {
    this.mockData = data;
  }

  setMockPlan(plan: PlanResult) {
    this.mockPlan = plan;
  }

  setMockPlans(plans: PlanResult[]) {
    this.mockPlans = [...plans];
  }

  setPlanHandler(handler?: (prompt: string, context?: unknown) => PlanResult | Promise<PlanResult>) {
    this.planHandler = handler;
  }

  setStructuredOutputHandler(handler?: <T = unknown>(options: GenerateStructuredOutputOptions<T>) => StructuredOutputResult<T> | Promise<StructuredOutputResult<T>>) {
    this.structuredOutputHandler = handler;
  }


  private async simulateDelay(options?: ProviderRequestOptions): Promise<void> {
    const delay = this.mode === 'slow' ? 2000 : this.latencyMs;
    if (delay <= 0) {
      if (options?.signal?.aborted) {
        throw new ProviderError('Operation was cancelled', 'CANCELLED');
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve();
      }, delay);

      if (options?.signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new ProviderError('Operation was cancelled', 'CANCELLED'));
        };
        if (options.signal.aborted) {
          clearTimeout(timer);
          reject(new ProviderError('Operation was cancelled', 'CANCELLED'));
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async healthCheck(options?: ProviderRequestOptions): Promise<ProviderHealthResult> {
    await this.simulateDelay(options);

    if (this.mode === 'offline' || !this.healthy) {
      return {
        healthy: false,
        provider: this.name,
        model: this.model,
        message: 'Mock provider is set to offline or unhealthy',
      };
    }

    return {
      healthy: true,
      provider: this.name,
      model: this.model,
      latencyMs: this.latencyMs,
    };
  }

  async generateStructuredOutput<T = unknown>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredOutputResult<T>> {
    if (options.signal?.aborted) {
      throw new ProviderError('Operation was cancelled', 'CANCELLED');
    }

    if (this.mode === 'offline') {
      throw new ProviderError('Mock provider is offline', 'PROVIDER_OFFLINE');
    }

    if (this.mode === 'timeout') {
      throw new ProviderError('Mock provider request timed out', 'TIMEOUT');
    }

    await this.simulateDelay(options);

    if (this.mode === 'invalid_response') {
      return {
        success: false,
        error: 'Failed to parse structured JSON from mock provider',
        rawText: 'MALFORMED_NON_JSON_DATA_<<<',
      };
    }

    if (this.structuredOutputHandler) {
      return this.structuredOutputHandler(options);
    }

    let payload = this.mockData as any;

    const isStageExamRequest = Boolean(
      (options.schema as any)?.properties?.sections ||
      options.userPrompt?.includes('- Section:')
    );

    if (isStageExamRequest && (!payload || !payload.sections)) {
      payload = buildMockStageExamPayload(options);
    } else if ((options.schema as any)?.properties?.passage && (!payload || !payload.passage)) {
      payload = {
        passage:
          'Comprehensive Reading Passage: In modern Egyptian schools, students engage actively in exploring real-world scientific applications. Through collaborative project-based learning and critical thinking exercises, young scholars develop indispensable problem-solving competencies that empower them to address future national challenges with academic confidence and excellence.',
      };
    } else if ((options.schema as any)?.properties?.listeningScript && (!payload || !payload.listeningScript)) {
      payload = {
        listeningScript:
          "Teacher's Listening Script: Yesterday, Egyptian researchers announced a successful renewable energy initiative in Benban, Aswan. The project team established state-of-the-art monitoring facilities and provided specialized vocational training for local technicians.",
      };
    } else if (options.userPrompt?.includes('additional, original questions for section')) {
      const match = options.userPrompt.match(/Generate EXACTLY (\d+) additional, original questions for section "([a-zA-Z_]+)"/i);
      const neededCount = match ? parseInt(match[1], 10) : 2;
      const secType = match ? match[2].toLowerCase() : 'vocabulary';
      const repairQs = [];
      for (let i = 0; i < neededCount; i++) {
        repairQs.push({
          questionNumber: i + 1,
          questionType: secType === 'reading' ? 'reading_comprehension' : secType === 'translation' ? 'translation' : 'mcq',
          prompt: `Targeted repair item ${Date.now()}_${i} for ${secType}: The team managed to ........ key project outcomes successfully.`,
          options: ['achieve', 'ruin', 'neglect', 'forget'],
          correctAnswer: 'achieve',
          correctIndex: 0,
          explanation: 'Contextual achievement verb.',
          marks: 1,
        });
      }
      payload = { questions: repairQs };
    } else if (
      (!payload || !payload.questions) &&
      (options.userPrompt?.includes('questions') || options.systemPrompt?.includes('assessment'))
    ) {
      payload = {
        questions: [
          {
            prompt: 'The bank ........ by thieves last night.',
            options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
            correctAnswer: 'was robbed',
            correctIndex: 1,
            explanation: 'هنا البنك هو اللي اتعمل عليه الفعل، فمحتاجين Passive Voice. ومع Past Simple بنستخدم was/were + P.P.، علشان كده was robbed هي الصح.',
          },
          {
            prompt: 'While Ahmed was walking home, he ........ his old teacher.',
            options: ['meets', 'met', 'has met', 'was meet'],
            correctAnswer: 'met',
            correctIndex: 1,
            explanation: 'هنا عندنا حدث قطع حدث تاني كان مستمر في الماضي، فمحتاجين Past Simple، والماضي من meet هو met.',
          },
          {
            prompt: 'Mona has lived here ........ 2022.',
            options: ['for', 'since', 'ago', 'from'],
            correctAnswer: 'since',
            correctIndex: 1,
            explanation: 'وجود since مع نقطة بداية زي 2022 معناه إننا محتاجين Present Perfect، علشان كده الاختيار الصح since.',
          },
          {
            prompt: 'At eight, he ........ breakfast. He was in the middle of breakfast.',
            options: ['had eaten', 'has', 'is having', 'was having'],
            correctAnswer: 'was having',
            correctIndex: 3,
            explanation: 'وجود He was in the middle of breakfast معناه إن الفعل كان مستمر في اللحظة دي في الماضي، فمحتاجين Past Continuous. علشان كده was having هي الصح.',
          },
          {
            prompt: 'The thieves ........ the bank and killed the guard.',
            options: ['rob', 'robbed', 'robbing', 'are rob'],
            correctAnswer: 'robbed',
            correctIndex: 1,
            explanation: 'عندنا killed في نفس الجملة، وده حدث حصل وخلص في الماضي، فالفعل التاني لازم يمشي معاه في Past Simple. علشان كده robbed هي الصح.',
          },
        ],
      };
    }

    return {
      success: true,
      data: payload as T,
      rawText: JSON.stringify(payload),
      usage: {
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
      },
    };
  }

  async generatePlan(
    _prompt: string,
    _context?: unknown,
    options?: ProviderRequestOptions
  ): Promise<PlanResult> {
    if (options?.signal?.aborted) {
      throw new ProviderError('Operation was cancelled', 'CANCELLED');
    }

    if (this.mode === 'offline') {
      throw new ProviderError('Mock provider is offline', 'PROVIDER_OFFLINE');
    }

    if (this.mode === 'timeout') {
      throw new ProviderError('Mock provider request timed out', 'TIMEOUT');
    }

    await this.simulateDelay(options);

    if (this.planHandler) {
      return this.planHandler(_prompt, _context);
    }

    if (this.mockPlans && this.mockPlans.length > 0) {
      return this.mockPlans.shift()!;
    }

    return this.mockPlan;
  }

  async unloadModel(): Promise<boolean> {
    return true;
  }
}


function buildMockStageExamPayload(options: GenerateStructuredOutputOptions<any>): any {
  const prompt = options.userPrompt || '';
  const sys = options.systemPrompt || '';

  // Extract stage
  let stage: 'primary' | 'preparatory' | 'secondary' | 'thanaweya' = 'secondary';
  if (sys.includes('Primary') || prompt.includes('Primary') || prompt.includes('???????')) stage = 'primary';
  else if (sys.includes('Prep') || prompt.includes('Prep') || prompt.includes('??????')) stage = 'preparatory';
  else if (sys.includes('Thanaweya') || prompt.includes('Thanaweya') || prompt.includes('?????? ????') || prompt.includes('sec_3')) stage = 'thanaweya';
  else if (sys.includes('Secondary') || prompt.includes('Secondary') || prompt.includes('?????')) stage = 'secondary';

  // Extract source topic
  let topic = 'Modern Science and Heritage in Egypt';
  const docMatch = prompt.match(/"""([\s\S]*?)"""/);
  if (docMatch && docMatch[1].trim()) {
    const rawDoc = docMatch[1].trim();
    const firstLine = rawDoc.split('\n')[0].replace(/^#+\s*/, '').trim();
    if (firstLine.length > 3) {
      topic = firstLine.slice(0, 80);
    }
  }

  // Parse requested sections from prompt
  // e.g. "- Section: listening (A. Listening Comprehension): EXACTLY 2 questions"
  // or "- Section: vocabulary: EXACTLY 4 questions"
  const sectionMatches = Array.from(prompt.matchAll(/- Section:\s*([a-zA-Z_]+).*?:\s*EXACTLY\s*(\d+)\s*questions/gi));

  const parsedAllocations: Array<{ sectionType: string; count: number }> = [];
  if (sectionMatches.length > 0) {
    for (const m of sectionMatches) {
      parsedAllocations.push({
        sectionType: m[1].toLowerCase(),
        count: parseInt(m[2], 10),
      });
    }
  } else {
    // Default allocations if not parsed
    if (stage === 'primary') {
      parsedAllocations.push({ sectionType: 'vocabulary', count: 4 }, { sectionType: 'grammar', count: 4 }, { sectionType: 'reading', count: 2 });
    } else if (stage === 'preparatory') {
      parsedAllocations.push({ sectionType: 'dialogue', count: 2 }, { sectionType: 'vocabulary', count: 4 }, { sectionType: 'reading', count: 4 }, { sectionType: 'translation', count: 2 });
    } else {
      parsedAllocations.push({ sectionType: 'vocabulary', count: 5 }, { sectionType: 'grammar', count: 5 }, { sectionType: 'reading', count: 6 }, { sectionType: 'translation', count: 4 });
    }
  }

  let qGlobalNum = 1;
  const sections = parsedAllocations.map((alloc, sIdx) => {
    const secType = alloc.sectionType;
    let title = `${String.fromCharCode(65 + sIdx)}. ${secType.charAt(0).toUpperCase() + secType.slice(1)}`;
    let titleAr = `?????: ${secType}`;
    let passage: string | undefined = undefined;
    let listeningScript: string | undefined = undefined;

    if (secType === 'reading') {
      passage = `Comprehensive Reading Passage on ${topic}: In modern Egyptian schools, students engage actively in exploring real-world scientific applications. Through collaborative project-based learning and critical thinking exercises, young scholars develop indispensable problem-solving competencies that empower them to address future national challenges with academic confidence and excellence.`;
    } else if (secType === 'listening') {
      listeningScript = `Teacher's Listening Script for ${topic}: Yesterday, Egyptian researchers announced a successful renewable energy initiative in Benban, Aswan. The project team established state-of-the-art monitoring facilities and provided specialized vocational training for local technicians.`;
    }

    const questions: any[] = [];
    for (let i = 0; i < alloc.count; i++) {
      const qNum = qGlobalNum++;
      if (secType === 'listening') {
        const listeningPrompts = [
          `According to the listening text on ${topic}, where was the project established?`,
          `What main objective did the researchers achieve regarding ${topic}?`,
          `Who participated in the specialized vocational training session?`,
          `How did the team ensure sustainable operations at the facility?`,
          `What future plan was highlighted by the chief engineer in the report?`,
          `Which technology contributed most significantly to monitoring the system?`,
        ];
        questions.push({
          questionNumber: qNum,
          questionType: 'listening_mcq',
          prompt: listeningPrompts[i] || `Listening item ${i + 1} regarding ${topic}: What factor was most critical?`,
          options: ['In Benban, Aswan', 'In Alexandria Harbor', 'In the Red Sea', 'In Cairo Airport'],
          correctAnswer: 'In Benban, Aswan',
          correctIndex: 0,
          explanation: 'As mentioned in the teacher listening script: renewable energy initiative in Benban, Aswan.',
          marks: 1,
        });
      } else if (secType === 'reading') {
        const readingPrompts = [
          `According to the passage on ${topic}, what significantly improves student problem-solving skills?`,
          `What does the author suggest about combining digital tools with traditional mentorship?`,
          `The word 'indispensable' in paragraph 2 is closest in meaning to:`,
          `What is the central theme of the passage regarding ${topic}?`,
          `Which statement can be inferred from the author's discussion of student collaboration?`,
          `Why do schools in Egypt emphasize practical challenges alongside academic study?`,
          `What tone does the author maintain throughout the concluding remarks?`,
          `According to the text, what enables young learners to acquire lasting competence?`,
        ];
        questions.push({
          questionNumber: qNum,
          questionType: 'reading_comprehension',
          prompt: readingPrompts[i] || `Reading comprehension item ${i + 1} based on ${topic}:`,
          options: [
            'Collaborative projects and critical thinking',
            'Memorizing answers without comprehension',
            'Ignoring scientific principles completely',
            'Relying solely on automated algorithms'
          ],
          correctAnswer: 'Collaborative projects and critical thinking',
          correctIndex: 0,
          explanation: 'Directly supported by the passage: collaborative projects and critical thinking increase problem-solving skills significantly.',
          marks: 2,
        });
      } else if (secType === 'dialogue') {
        const dialoguePrompts = [
          `Omar: What do you think about ${topic}?\nTamer: ........`,
          `Salma: How can we apply the concepts of ${topic} in our daily life?\nHeba: ........`,
          `Teacher: Can you explain the main advantage of ${topic}?\nStudent: ........`,
          `Karim: Did you finish the research report on ${topic}?\nZiad: ........`,
          `Mona: Why is this lesson on ${topic} so important for our exams?\nNour: ........`,
          `Amr: Have you reviewed the vocabulary related to ${topic}?\nAdel: ........`,
        ];
        questions.push({
          questionNumber: qNum,
          questionType: 'dialogue_complete',
          prompt: dialoguePrompts[i] || `Speaker A: Discussion on ${topic} (exchange ${i + 1}).\nSpeaker B: ........`,
          options: [
            'I think it is very important for our future.',
            'No, I never play tennis on Fridays.',
            'Yes, my favorite color is dark blue.',
            'I went to the supermarket yesterday.'
          ],
          correctAnswer: 'I think it is very important for our future.',
          correctIndex: 0,
          explanation: 'Logical response expressing an opinion on the topic.',
          marks: 1,
        });
      } else if (secType === 'translation') {
        const transPrompts = [
          `Choose the correct Arabic translation: "Modern educational reforms aim to foster innovation and practical skills among Egyptian students."`,
          `Choose the correct English translation: "???? ?????? ??????? ?????? ?????? ?????? ??????? ???????? ??????."`,
          `Choose the correct Arabic translation: "Renewable energy and scientific research are vital pillars for sustainable development."`,
          `Choose the correct English translation: "?????? ??????? ??????? ???????? ??????? ??? ????? ?????? ?? ????????."`,
          `Choose the correct Arabic translation: "Youth empowerment and vocational excellence contribute directly to national economic growth."`,
          `Choose the correct English translation: "???? ??????????? ??????? ????? ??????? ?? ????? ??????? ?????? ??????? ??? ????????."`,
        ];
        questions.push({
          questionNumber: qNum,
          questionType: 'translation',
          prompt: transPrompts[i] || `Translation sentence ${i + 1} regarding ${topic}: Choose the accurate equivalent.`,
          options: [
            '???? ????????? ????????? ??????? ??? ????? ???????? ????????? ??????? ??? ?????? ????????.',
            '???? ??????? ??????? ??????? ?????? ?? ??????? ???????? ??????? ?????????.',
            '??? ??????? ?? ?????? ???? ????????? ??????? ??? ?? ????? ?? ??????.',
            '???? ?????? ?? ??? ????? ??????? ??????? ????????? ??? ????? ???.'
          ],
          correctAnswer: '???? ????????? ????????? ??????? ??? ????? ???????? ????????? ??????? ??? ?????? ????????.',
          correctIndex: 0,
          explanation: '??????? ??????? ???????? ??????.',
          marks: 2,
        });
      } else if (secType === 'writing') {
        const writingPrompts = [
          stage === 'primary'
            ? `Write a short paragraph of 4 sentences about: "${topic}". Use the following guide words: [important - learn - school - future].`
            : stage === 'preparatory'
            ? `Write an email or paragraph of about 80-90 words about: "${topic}". Explain why it matters in our daily life.`
            : `Write an essay of about 150-180 words discussing: "${topic}". Support your ideas with logical arguments and examples.`,
          stage === 'primary'
            ? `Write 3 sentences describing what you learned about "${topic}" in your English class.`
            : stage === 'preparatory'
            ? `Write a paragraph of 80 words suggesting ways students can benefit from "${topic}".`
            : `Write an analytical article of 150 words proposing innovative solutions regarding "${topic}".`,
        ];
        questions.push({
          questionNumber: qNum,
          questionType: 'short_writing',
          prompt: writingPrompts[i] || `Write a comprehensive guided composition on ${topic} (Task ${i + 1}).`,
          options: undefined,
          correctAnswer: 'Guided Writing according to stage rubric.',
          explanation: 'Assessed using official Egyptian Ministry writing rubric.',
          marks: stage === 'primary' ? 4 : stage === 'preparatory' ? 6 : 8,
        });
      } else if (secType === 'rewrite') {
        questions.push({
          questionNumber: qNum,
          questionType: 'rewrite',
          prompt: `Rewrite using the word in brackets: "He started studying ${topic} two hours ago." [for] (Item ${i + 1})`,
          options: undefined,
          correctAnswer: `He has been studying ${topic} for two hours.`,
          explanation: 'Using present perfect continuous with for to denote continuous duration.',
          marks: 2,
        });
      } else if (secType === 'grammar') {
        questions.push({
          questionNumber: qNum,
          questionType: 'mcq',
          prompt: `While the researchers were analyzing the data on ${topic}, they ........ an unexpected breakthrough. (Item ${i + 1})`,
          options: ['discovered', 'discovers', 'was discover', 'had discover'],
          correctAnswer: 'discovered',
          correctIndex: 0,
          explanation: 'Past continuous was analyzing interrupted by a past simple event discovered.',
          marks: 1,
        });
      } else {
        // Vocabulary or generic
        questions.push({
          questionNumber: qNum,
          questionType: 'mcq',
          prompt: `Egyptian specialists are working hard to ........ sustainable solutions regarding ${topic}. (Item ${i + 1})`,
          options: ['implement', 'destroy', 'abandon', 'ignore'],
          correctAnswer: 'implement',
          correctIndex: 0,
          explanation: 'Implement (???? / ????) fits the positive educational context of the sentence.',
          marks: 1,
        });
      }
    }

    return {
      sectionType: secType,
      title,
      titleAr,
      instructions: `Answer all questions in this section carefully.`,
      passage,
      listeningScript,
      questions,
    };
  });

  return {
    examTitle: `Official Examination in English - ${topic}`,
    listeningScript: `Teacher Listening Script for ${topic}: Yesterday, Egyptian researchers announced a successful renewable energy initiative in Benban, Aswan.`,
    writingRubric: `Official Egyptian Ministry Writing Rubric: 1) Content & Ideas (2.5 marks), 2) Organization & Coherence (2 marks), 3) Vocabulary Range (2 marks), 4) Mechanics & Accuracy (1.5 marks).`,
    teacherNotes: `Exam generated authentically for Egyptian curriculum standards.`,
    sections,
  };
}
