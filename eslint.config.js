import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {ignores:['dist/**','node_modules/**','refs/**','worker-configuration.d.ts']},
  js.configs.recommended,
  {
    files:['src/**/*.ts','server/**/*.ts'],
    languageOptions:{parser:tseslint.parser,parserOptions:{project:['./tsconfig.json','./tsconfig.worker.json']}},
    plugins:{'@typescript-eslint':tseslint.plugin},
    rules:{'no-undef':'off','no-unused-vars':'off','@typescript-eslint/no-unused-vars':'error'},
  },
  {
    files:['src/**/*.js'],
    languageOptions:{globals:{console:'readonly'}},
    rules:{'no-unused-vars':['error',{varsIgnorePattern:'^_',argsIgnorePattern:'^_'}]},
  },
  {files:['scripts/**/*.mjs'],languageOptions:{globals:{console:'readonly',performance:'readonly',process:'readonly'}}},
);
