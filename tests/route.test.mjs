import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSubject } from '../src/ui/route.js';

test('「主体，附属」写法拆分：最后一段是附属点，其余拼回主体', () => {
  assert.deepEqual(splitSubject('广州石化小学，大门'), { subject: '广州石化小学', sub: '大门' });
  assert.deepEqual(splitSubject('华南农业大学 东门'), { subject: '华南农业大学', sub: '东门' });
  assert.deepEqual(splitSubject('天河区人民政府'), { subject: '天河区人民政府', sub: '' });
  assert.deepEqual(splitSubject('体育西路地铁站，B 口'), { subject: '体育西路地铁站', sub: 'B 口' });
  assert.deepEqual(splitSubject(''), { subject: '', sub: '' });
});
