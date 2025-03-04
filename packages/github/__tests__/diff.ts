import { buildSchema, Source } from 'graphql';
import nock from 'nock';
import {
  diff,
  DiffInterceptorPayload,
  DiffInterceptorResponse,
} from '../src/helpers/diff';
import { CheckConclusion } from '../src/helpers/types';
import { CriticalityLevel } from '@graphql-inspector/core';

function getPrintedLine(source: Source, line: number): string {
  return source.body.split(/\r\n|[\n\r]/g)[line - 1].trim();
}

function build(oldSource: string, newSource: string) {
  const sources = {
    old: new Source(oldSource),
    new: new Source(newSource),
  };
  const schemas = {
    old: buildSchema(sources.old),
    new: buildSchema(sources.new),
  };

  return {
    sources,
    schemas,
  };
}

const newSchema = /* GraphQL */ `
  type Post {
    id: ID!
    title: String!
    createdAt: String!
  }

  type Query {
    post: Post!
  }
`;

const oldSchema = /* GraphQL */ `
  type Post {
    id: ID
    title: String @deprecated(reason: "No more used")
    createdAt: String
    modifiedAt: String
  }

  type Query {
    post: Post!
    posts: [Post!]
  }
`;

test('should return 7 annotations and 7 changes and fail the check', async () => {
  const action = await diff({
    path: 'schema.graphql',
    ...build(oldSchema, newSchema),
  });

  expect(action.annotations).toHaveLength(7);
  expect(action.changes).toHaveLength(7);
  expect(action.conclusion).toBe(CheckConclusion.Failure);
});

test('annotations should match lines in schema file', async () => {
  const { schemas, sources } = build(oldSchema, newSchema);
  const action = await diff({
    path: 'schema.graphql',
    schemas,
    sources,
  });

  // Field 'modifiedAt' was removed from object type 'Post'
  expect(getPrintedLine(sources.new, action.annotations![0].start_line)).toBe(
    'type Post {',
  );

  // Field 'Post.createdAt' changed type from 'String' to 'String!'
  expect(getPrintedLine(sources.new, action.annotations![5].start_line)).toBe(
    'createdAt: String!',
  );
});

test('should work with comments and descriptions', async () => {
  const { sources, schemas } = build(
    /* GraphQL */ `
      # This is an autogenerated file.
      # Please do not edit it directly.

      """
      Represents meta information about this service.
      """
      type Meta {
        """
        A short description of the service.
        """
        description: String!

        name: String!

        """
        Version number of the service.
        """
        version: String!
      }
    `,
    /* GraphQL */ `
      # This is an autogenerated file.
      # Please do not edit it directly.

      """
      Represents a user of the application.
      """
      type User {
        """
        The user's email.
        """
        email: String!

        """
        The user's first name.
        """
        firstName: String!
        """
        The user's last name.
        """
        lastName: String!
        """
        The user's phone number.
        """
        phoneNumber: String!
        """
        A URL pointing to the user's public avatar.
        """
        avatarURL: String!
      }

      """
      Represents meta information about this service.
      """
      type Meta {
        """
        A short description of the service.
        """
        description: String!
        name: String
      }
    `,
  );

  const action = await diff({
    path: 'schema.graphql',
    schemas,
    sources,
  });

  expect(action.annotations).toHaveLength(3);

  // Type 'User' was added
  expect(getPrintedLine(sources.new, action.annotations![0].start_line)).toBe(
    'type User {',
  );
  // Field 'version' was removed from object type 'Meta'
  expect(getPrintedLine(sources.new, action.annotations![1].start_line)).toBe(
    'type Meta {',
  );
  // Field 'Meta.name' changed type from 'String!' to 'String'
  expect(getPrintedLine(sources.new, action.annotations![2].start_line)).toBe(
    'name: String',
  );
});

test('use interceptor to modify changes', async () => {
  const scope = nock('https://api.com')
    .post('/intercept')
    .reply(async (_, body: DiffInterceptorPayload) => {
      const response: DiffInterceptorResponse = {
        changes: body.changes.map((c) => {
          c.criticality.level = 'NON_BREAKING' as any;
          return { ...c };
        }),
      };
      return [200, response];
    });
  const action = await diff({
    path: 'schema.graphql',
    ...build(oldSchema, newSchema),
    interceptor: 'https://api.com/intercept',
  });

  expect(action.annotations).toHaveLength(7);
  expect(action.changes).toHaveLength(7);
  expect(
    action.changes.every(
      (change) => change.criticality.level === CriticalityLevel.NonBreaking,
    ),
  ).toBe(true);
  expect(action.conclusion).toBe(CheckConclusion.Success);

  scope.done();
});

test('use interceptor to modify check conclusion', async () => {
  const scope = nock('https://api.com')
    .post('/intercept')
    .reply(async (_, body: DiffInterceptorPayload) => {
      const response: DiffInterceptorResponse = {
        changes: body.changes,
        conclusion: 'neutral' as any,
      };
      return [200, response];
    });
  const action = await diff({
    path: 'schema.graphql',
    ...build(oldSchema, newSchema),
    interceptor: 'https://api.com/intercept',
  });

  expect(action.annotations).toHaveLength(7);
  expect(action.changes).toHaveLength(7);
  expect(action.conclusion).toBe(CheckConclusion.Neutral);

  scope.done();
});
