import type { Knex } from 'knex';
import { hashComment } from '../../graphql/schema/comment/utils/comment-hash';

export async function seed(knex: Knex): Promise<void> {
  await knex.raw('SET FOREIGN_KEY_CHECKS=0');
  await knex('comments').truncate();
  await knex.raw('SET FOREIGN_KEY_CHECKS=1');

  const rows = [
    {
      id: 105,
      comment:
        'Iusto et dolorem sed sint et. Molestiae ut accusantium qui cupiditate. Earum alias praesentium. Ut quod porro placeat sit quis harum voluptas.',
      user_id: '502',
      post_id: '833',
      created_at: new Date('2020-11-17T13:19:25.118Z'),
    },
    {
      id: 196,
      comment:
        'Nihil nihil placeat molestiae vel quo iure libero aliquam. Praesentium officia distinctio iusto id maiores et neque et.',
      user_id: '592',
      post_id: '783',
      created_at: new Date('2017-04-16T13:19:03.982Z'),
    },
    {
      id: 235,
      comment:
        'Explicabo mollitia omnis vel dolorem at inventore. Illo non qui iste dolor totam at eos et. Voluptatem alias eveniet facilis sed officiis.',
      user_id: '935',
      post_id: '361',
      created_at: new Date('2018-11-04T01:35:02.585Z'),
    },
    {
      id: 257,
      comment: 'Quos sequi maxime omnis est. Eaque qui eum.',
      user_id: '30',
      post_id: '50',
      created_at: new Date('2015-09-26T06:03:22.376Z'),
    },
    {
      id: 315,
      comment:
        'Consectetur saepe et odio illo recusandae excepturi soluta. Veniam in voluptatum voluptas eius.',
      user_id: '439',
      post_id: '645',
      created_at: new Date('2017-01-10T00:02:22.315Z'),
    },
    {
      id: 340,
      comment:
        'Delectus blanditiis mollitia reprehenderit quos eligendi autem harum. Rerum provident sit sit. Voluptas id soluta rerum suscipit accusantium harum quia ea impedit.',
      user_id: '30',
      post_id: '50',
      created_at: new Date('2015-09-27T05:41:20.453Z'),
    },
    {
      id: 355,
      comment:
        'Odio maiores ut error sint ullam placeat similique incidunt velit. Odio maiores voluptatem omnis non rerum. Ab ducimus quibusdam impedit asperiores illo magnam et at quisquam. Sint vel non ut quisquam. Quia eum rerum aut voluptatibus.',
      user_id: '29',
      post_id: '361',
      created_at: new Date('2018-03-01T18:38:37.370Z'),
    },
    {
      id: 423,
      comment:
        'Id maxime placeat sit ipsa repellendus nisi temporibus. Iure nobis autem deleniti. Molestiae ratione explicabo. Ex voluptatem non. Consequatur voluptatem consequuntur. Expedita aut sint omnis deserunt repudiandae.',
      user_id: '453',
      post_id: '455',
      created_at: new Date('2018-08-14T00:39:08.464Z'),
    },
    {
      id: 427,
      comment:
        'Sed et et doloribus nam dignissimos modi et quasi eaque. Dicta nihil sit dolores.',
      user_id: '30',
      post_id: '50',
      created_at: new Date('2017-07-28T21:26:35.308Z'),
    },
    {
      id: 485,
      comment:
        'Culpa occaecati molestiae enim qui recusandae qui. Quam praesentium aperiam consectetur quas excepturi earum quis hic. Repellendus expedita nam quis ducimus. Est labore voluptate laborum.',
      user_id: '592',
      post_id: '783',
      created_at: new Date('2019-12-07T01:45:48.605Z'),
    },
    {
      id: 535,
      comment:
        'Quia aut voluptatum esse. Earum et est est nulla repellendus qui natus autem est.',
      user_id: '30',
      post_id: '50',
      created_at: new Date('2019-08-12T03:51:14.551Z'),
    },
    {
      id: 556,
      comment:
        'Neque voluptate vel est tempore odio. Error in quaerat molestiae voluptas quo maiores qui rerum.',
      user_id: '439',
      post_id: '645',
      created_at: new Date('2019-05-05T03:43:37.743Z'),
    },
    {
      id: 593,
      comment:
        'Et placeat reprehenderit consequatur esse maxime dolores. Ab odio veniam delectus ipsam aspernatur sed delectus. In dolorum at optio qui. Sunt quo rerum beatae in quae ipsum quo.',
      user_id: '935',
      post_id: '361',
      created_at: new Date('2019-09-01T10:27:59.303Z'),
    },
    {
      id: 138,
      comment:
        'Sunt consectetur incidunt et atque occaecati repudiandae in. Expedita sequi quo aliquid. Ea occaecati quia occaecati maiores sunt. Delectus illum ut vero ducimus maxime sed. Cum ex hic perferendis incidunt officiis eveniet velit reprehenderit facilis. Odio temporibus omnis ea fugit ipsum.',
      user_id: '903',
      post_id: '15',
      created_at: new Date('2021-03-25T20:16:21.308Z'),
    },
    {
      id: 738,
      comment:
        'Consequatur qui eligendi excepturi voluptatibus magni voluptas et cupiditate. Possimus et praesentium esse necessitatibus commodi. Expedita in dolorem sit libero illum eum dicta cupiditate aliquid. Quod quod nulla laboriosam suscipit animi enim in.',
      user_id: '935',
      post_id: '361',
      created_at: new Date('2019-03-10T08:26:48.274Z'),
    },
    {
      id: 755,
      comment:
        'Ut quia necessitatibus cum et explicabo ipsum. Atque veniam sed rerum enim et. Iusto aut enim. Officiis reiciendis id voluptatem vero sit et placeat distinctio. Ipsam consequuntur non accusantium quisquam sit nihil sit velit.',
      user_id: '115',
      post_id: '481',
      created_at: new Date('2017-07-22T02:21:16.960Z'),
    },
    {
      id: 780,
      comment: 'Ipsa iure molestiae et odit. Omnis enim enim eum.',
      user_id: '453',
      post_id: '455',
      created_at: new Date('2018-11-13T00:26:04.521Z'),
    },
    {
      id: 790,
      comment:
        'Deleniti quo et voluptates qui est dolores. Aspernatur et ut sint. Laborum voluptatem harum et natus laborum. Eos pariatur iure cumque.',
      user_id: '453',
      post_id: '455',
      created_at: new Date('2017-06-09T09:23:50.696Z'),
    },
    {
      id: 795,
      comment:
        'Aperiam neque dolor eius eveniet dignissimos veritatis sed neque.',
      user_id: '453',
      post_id: '455',
      created_at: new Date('2016-02-16T01:09:53.056Z'),
    },
    {
      id: 826,
      comment:
        'Odit cum nihil est beatae officiis at tenetur nam aut. Voluptatem suscipit saepe ea unde ex numquam libero.',
      user_id: '29',
      post_id: '361',
      created_at: new Date('2019-02-20T01:29:37.696Z'),
    },
    {
      id: 828,
      comment:
        'Qui aut in ut deleniti id eaque unde autem. Optio est facilis assumenda est repellat omnis voluptas. Et sit quae quia quia tempora quas in distinctio. Occaecati est natus et qui eligendi esse voluptas sed quia.',
      user_id: '453',
      post_id: '455',
      created_at: new Date('2016-02-04T09:45:18.818Z'),
    },
    {
      id: 167,
      comment:
        'Aperiam amet accusamus soluta ratione dolorem est pariatur possimus at. Quos commodi velit officia. Est quam ut necessitatibus. In culpa repudiandae sed nihil ipsum quo voluptatem dolorum numquam.',
      user_id: '453',
      post_id: '455',
      created_at: new Date('2019-06-12T10:42:06.037Z'),
    },
    {
      id: 953,
      comment:
        'Aspernatur suscipit et omnis at alias ut architecto nam. Blanditiis minima molestiae quia modi ea nulla maiores.',
      user_id: '115',
      post_id: '481',
      created_at: new Date('2019-04-27T21:46:15.870Z'),
    },
    {
      id: 974,
      comment:
        'Maiores autem qui autem veritatis cupiditate cupiditate sit ipsum. Quasi alias qui officiis minima et.',
      user_id: '958',
      post_id: '638',
      created_at: new Date('2018-12-10T08:05:30.215Z'),
    },
  ];

  await knex('comments').insert(
    rows.map((row) => ({ ...row, comment_hash: hashComment(row.comment) })),
  );
}
